from __future__ import annotations

import abc
import io
import logging
import mmap
import os
import tempfile
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha1
from typing import TYPE_CHECKING, Any, Generic, TypeVar

import sentry_sdk
from django.core.files.base import ContentFile
from django.core.files.base import File as FileObj
from django.db import IntegrityError, models, router, transaction
from django.utils import timezone

from sentry.backup.scopes import RelocationScope
from sentry.celery import SentryTask
from sentry.db.models import JSONField, Model, WrappingU32IntegerField
from sentry.models.files.abstractfileblob import AbstractFileBlob
from sentry.models.files.abstractfileblobindex import AbstractFileBlobIndex
from sentry.models.files.utils import DEFAULT_BLOB_SIZE, AssembleChecksumMismatch, nooplogger
from sentry.utils import metrics
from sentry.utils.rollback_metrics import incr_rollback_metrics

logger = logging.getLogger(__name__)


class ChunkedFileBlobIndexWrapper:
    def __init__(self, indexes, mode=None, prefetch=False, prefetch_to=None, delete=True):
        # eager load from database incase its a queryset
        self._indexes = list(indexes)
        self._curfile = None
        self._curidx = None
        if prefetch:
            self.prefetched = True
            self._prefetch(prefetch_to, delete)
        else:
            self.prefetched = False
        self.mode = mode
        self.open()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, tb) -> None:
        self.close()

    def detach_tempfile(self):
        if not self.prefetched:
            raise TypeError("Can only detech tempfiles in prefetch mode")
        assert self._curfile is not None
        rv = self._curfile
        self._curfile = None
        self.close()
        rv.seek(0)
        return rv

    def _nextidx(self) -> None:
        assert not self.prefetched, "this makes no sense"
        old_file = self._curfile
        try:
            try:
                self._curidx = next(self._idxiter)
                self._curfile = self._curidx.blob.getfile()
            except StopIteration:
                self._curidx = None
                self._curfile = None
        finally:
            if old_file is not None:
                old_file.close()

    @property
    def size(self):
        return sum(i.blob.size for i in self._indexes)

    def open(self) -> None:
        self.closed = False
        self.seek(0)

    def _prefetch(self, prefetch_to=None, delete=True):
        size = self.size
        f = tempfile.NamedTemporaryFile(prefix="._prefetch-", dir=prefetch_to, delete=delete)
        if size == 0:
            self._curfile = f
            return

        # Zero out the file
        f.seek(size - 1)
        f.write(b"\x00")
        f.flush()

        mem = mmap.mmap(f.fileno(), size)

        def fetch_file(offset, getfile) -> None:
            with getfile() as sf:
                while True:
                    chunk = sf.read(65535)
                    if not chunk:
                        break
                    mem[offset : offset + len(chunk)] = chunk
                    offset += len(chunk)

        with ThreadPoolExecutor(max_workers=4) as exe:
            for idx in self._indexes:
                exe.submit(fetch_file, idx.offset, idx.blob.getfile)

        mem.flush()
        self._curfile = f

    def close(self) -> None:
        if self._curfile:
            self._curfile.close()
        self._curfile = None
        self._curidx = None
        self.closed = True

    def _seek(self, pos):
        if self.closed:
            raise ValueError("I/O operation on closed file")

        if self.prefetched:
            assert self._curfile is not None
            return self._curfile.seek(pos)

        if pos < 0:
            raise OSError("Invalid argument")
        if pos == 0 and not self._indexes:
            # Empty file, there's no seeking to be done.
            return

        for n, idx in enumerate(self._indexes[::-1]):
            if idx.offset <= pos:
                if idx != self._curidx:
                    self._idxiter = iter(self._indexes[-(n + 1) :])
                    self._nextidx()
                break
        else:
            raise ValueError("Cannot seek to pos")
        assert self._curfile is not None
        assert self._curidx is not None
        self._curfile.seek(pos - self._curidx.offset)

    def seek(self, pos, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            return self._seek(pos)
        if whence == io.SEEK_CUR:
            return self._seek(self.tell() + pos)
        if whence == io.SEEK_END:
            return self._seek(self.size + pos)

        raise ValueError(f"Invalid value for whence: {whence}")

    def tell(self):
        if self.closed:
            raise ValueError("I/O operation on closed file")
        if self.prefetched:
            assert self._curfile is not None
            return self._curfile.tell()
        if self._curfile is None:
            return self.size
        assert self._curidx is not None
        assert self._curfile is not None
        return self._curidx.offset + self._curfile.tell()

    def read(self, n=-1):
        if self.closed:
            raise ValueError("I/O operation on closed file")

        if self.prefetched:
            assert self._curfile is not None
            return self._curfile.read(n)

        result = bytearray()

        # Read to the end of the file
        if n < 0:
            while self._curfile is not None:
                blob_result = self._curfile.read(32768)
                if not blob_result:
                    self._nextidx()
                else:
                    result.extend(blob_result)

        # Read until a certain number of bytes are read
        else:
            while n > 0 and self._curfile is not None:
                blob_result = self._curfile.read(min(n, 32768))
                if not blob_result:
                    self._nextidx()
                else:
                    n -= len(blob_result)
                    result.extend(blob_result)

        return bytes(result)


BlobIndexType = TypeVar("BlobIndexType", bound=AbstractFileBlobIndex)
BlobType = TypeVar("BlobType", bound=AbstractFileBlob)

if TYPE_CHECKING:
    # Django doesn't permit models to have parent classes that are Generic
    # this kludge lets satisfy both mypy and django
    class _Parent(Generic[BlobIndexType, BlobType]):
        pass

else:

    class _Parent:
        def __class_getitem__(cls, _):
            return cls


class AbstractFile(Model, _Parent[BlobIndexType, BlobType]):
    __relocation_scope__ = RelocationScope.Excluded

    name = models.TextField()
    type = models.CharField(max_length=64)
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)
    headers: models.Field[dict[str, Any], dict[str, Any]] = JSONField()
    size = WrappingU32IntegerField(null=True)
    checksum = models.CharField(max_length=40, null=True, db_index=True)

    class Meta:
        abstract = True

    blobs: models.ManyToManyField

    @abc.abstractmethod
    def _blob_index_records(self) -> Sequence[BlobIndexType]: ...

    @abc.abstractmethod
    def _create_blob_index(self, blob: BlobType, offset: int) -> BlobIndexType: ...

    @abc.abstractmethod
    def _create_blob_from_file(self, contents: ContentFile, logger: Any) -> BlobType: ...

    @abc.abstractmethod
    def _get_blobs_by_id(self, blob_ids: Sequence[int]) -> models.QuerySet[BlobType]: ...

    @abc.abstractmethod
    def _delete_unreferenced_blob_task(self) -> SentryTask: ...

    def _get_chunked_blob(self, mode=None, prefetch=False, prefetch_to=None, delete=True):
        return ChunkedFileBlobIndexWrapper(
            self._blob_index_records(),
            mode=mode,
            prefetch=prefetch,
            prefetch_to=prefetch_to,
            delete=delete,
        )

    @sentry_sdk.tracing.trace
    def getfile(self, mode=None, prefetch=False):
        """Returns a file object.  By default the file is fetched on
        demand but if prefetch is enabled the file is fully prefetched
        into a tempfile before reading can happen.
        """
        impl = self._get_chunked_blob(mode, prefetch)
        return FileObj(impl, self.name)

    @sentry_sdk.tracing.trace
    def save_to(self, path) -> None:
        """Fetches the file and emplaces it at a certain location.  The
        write is done atomically to a tempfile first and then moved over.
        If the directory does not exist it is created.
        """
        path = os.path.abspath(path)
        base = os.path.dirname(path)
        os.makedirs(base, exist_ok=True)

        f = None
        try:
            f = self._get_chunked_blob(
                prefetch=True, prefetch_to=base, delete=False
            ).detach_tempfile()

            # pre-emptively check if the file already exists.
            # this can happen as a race condition if two processes/threads
            # are trying to cache the same file and both try to write
            # at the same time, overwriting each other. Normally this is fine,
            # but can cause an issue if another process has opened the file
            # for reading, then the file that was being read gets clobbered.
            # I don't know if this affects normal filesystems, but it
            # definitely has an issue if the filesystem is NFS.
            if not os.path.exists(path):
                os.rename(f.name, path)
                f.close()
                f = None
        finally:
            if f is not None:
                f.close()
                try:
                    os.remove(f.name)
                except Exception:
                    pass

    @sentry_sdk.tracing.trace
    def putfile(self, fileobj, blob_size=DEFAULT_BLOB_SIZE, commit=True, logger=nooplogger):
        """
        Save a fileobj into a number of chunks.

        Returns a list of `FileBlobIndex` items.

        >>> indexes = file.putfile(fileobj)
        """
        results = []
        offset = 0
        checksum = sha1(b"")

        while True:
            contents = fileobj.read(blob_size)
            if not contents:
                break
            checksum.update(contents)

            blob_fileobj = ContentFile(contents)
            blob = self._create_blob_from_file(blob_fileobj, logger=logger)
            results.append(self._create_blob_index(blob=blob, offset=offset))
            offset += blob.size
        self.size = offset
        self.checksum = checksum.hexdigest()
        metrics.distribution("filestore.file-size", offset, unit="byte")
        if commit:
            self.save()
        return results

    @sentry_sdk.tracing.trace
    def assemble_from_file_blob_ids(self, file_blob_ids, checksum):
        """
        This creates a file, from file blobs and returns a temp file with the
        contents.
        """
        tf = tempfile.NamedTemporaryFile()

        # All file tables are on the same connection and this lets us
        # bypass generics
        with transaction.atomic(using=router.db_for_write(type(self))):
            try:
                file_blobs_qs = self._get_blobs_by_id(blob_ids=file_blob_ids)

                # Ensure blobs are in the order and duplication as provided
                blobs_by_id = {blob.id: blob for blob in file_blobs_qs}
                file_blobs = [blobs_by_id[blob_id] for blob_id in file_blob_ids]
            except Exception:
                # Most likely a `KeyError` like `SENTRY-11QP` because an `id` in
                # `file_blob_ids` does suddenly not exist anymore
                logger.exception("`FileBlob` disappeared during `assemble_file`")
                raise

            new_checksum = sha1(b"")
            offset = 0
            for blob in file_blobs:
                try:
                    self._create_blob_index(blob=blob, offset=offset)
                except IntegrityError:
                    incr_rollback_metrics(name="file_assemble_from_file_blob_ids")
                    # Most likely a `ForeignKeyViolation` like `SENTRY-11P5`, because
                    # the blob we want to link does not exist anymore
                    logger.exception("`FileBlob` disappeared trying to link `FileBlobIndex`")
                    raise

                with blob.getfile() as blobfile:
                    for chunk in blobfile.chunks():
                        new_checksum.update(chunk)
                        tf.write(chunk)
                offset += blob.size

            self.size = offset
            self.checksum = new_checksum.hexdigest()

            if checksum != self.checksum:
                tf.close()
                raise AssembleChecksumMismatch("Checksum mismatch")

        metrics.distribution("filestore.file-size", offset, unit="byte")
        self.save()

        tf.flush()
        tf.seek(0)
        return tf

    @sentry_sdk.tracing.trace
    def delete(self, *args, **kwargs):
        blob_ids = [blob.id for blob in self.blobs.all()]
        ret = super().delete(*args, **kwargs)

        # Wait to delete blobs. This helps prevent
        # races around frequently used blobs in debug images and release files.
        transaction.on_commit(
            lambda: self._delete_unreferenced_blob_task().apply_async(
                kwargs={"blob_ids": blob_ids}, countdown=60 * 5
            ),
            using=router.db_for_write(type(self)),
        )

        return ret
