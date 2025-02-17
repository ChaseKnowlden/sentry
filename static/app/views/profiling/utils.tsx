import type {Location} from 'history';

import type {GridColumnOrder} from 'sentry/components/gridEditable';
import SortLink from 'sentry/components/gridEditable/sortLink';
import {t} from 'sentry/locale';
import type {SelectValue} from 'sentry/types/core';
import {defined} from 'sentry/utils';
import {
  isContinuousProfileReference,
  isTransactionProfileReference,
} from 'sentry/utils/profiling/guards/profile';
import {decodeScalar} from 'sentry/utils/queryString';

type ColorEncoding =
  | 'version' // this will use a concatenation of `app_version_name` and `app_version`
  | 'device_manufacturer'
  | 'device_model'
  | 'device_os_version'
  | 'transaction_name';

const COLOR_ENCODING_LABELS: Record<ColorEncoding, string> = {
  version: t('App Version'),
  device_manufacturer: t('Device Manufacturer'),
  device_model: t('Device Model'),
  device_os_version: t('Device Os Version'),
  transaction_name: t('Transaction Name'),
};

export const COLOR_ENCODINGS: Array<SelectValue<ColorEncoding>> = Object.entries(
  COLOR_ENCODING_LABELS
).map(([value, label]) => ({label, value: value as ColorEncoding}));

export function getColorEncodingFromLocation(location: Location): ColorEncoding {
  const colorCoding = decodeScalar(location.query.colorEncoding);

  if (defined(colorCoding) && COLOR_ENCODING_LABELS.hasOwnProperty(colorCoding)) {
    return colorCoding as ColorEncoding;
  }

  return 'transaction_name';
}

export function requestAnimationFrameTimeout(cb: () => void, timeout: number) {
  const rafId = {current: 0};
  const start = performance.now();

  function timer() {
    if (rafId.current) {
      window.cancelAnimationFrame(rafId.current);
    }
    if (performance.now() - start > timeout) {
      cb();
      return;
    }
    rafId.current = window.requestAnimationFrame(timer);
  }

  rafId.current = window.requestAnimationFrame(timer);
  return rafId;
}

export function renderTableHeader<K>(rightAlignedColumns: Set<K>) {
  return function (column: GridColumnOrder<K>, _columnIndex: number) {
    return (
      <SortLink
        align={rightAlignedColumns.has(column.key) ? 'right' : 'left'}
        title={column.name}
        direction={undefined}
        canSort={false}
        generateSortLink={() => undefined}
      />
    );
  };
}

export const DEFAULT_PROFILING_DATETIME_SELECTION = {
  start: null,
  end: null,
  utc: false,
  period: '24h',
};

export function getProfileTargetId(reference: Profiling.BaseProfileReference): string {
  if (isTransactionProfileReference(reference)) {
    return reference.profile_id;
  }
  if (isContinuousProfileReference(reference)) {
    return reference.profiler_id;
  }
  return reference;
}
