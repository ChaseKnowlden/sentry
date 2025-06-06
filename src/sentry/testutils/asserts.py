from functools import reduce

from django.http import StreamingHttpResponse

from sentry.constants import ObjectStatus
from sentry.integrations.types import EventLifecycleOutcome
from sentry.models.auditlogentry import AuditLogEntry
from sentry.models.commitfilechange import CommitFileChange
from sentry.models.organization import Organization
from sentry.models.project import Project
from sentry.silo.base import SiloMode
from sentry.testutils.silo import assume_test_silo_mode


def assert_mock_called_once_with_partial(mock, *args, **kwargs):
    """
    Similar to ``mock.assert_called_once_with()``, but we don't require all
    args and kwargs to be specified.
    """
    assert len(mock.mock_calls) == 1
    m_args, m_kwargs = mock.call_args
    for i, arg in enumerate(args):
        assert m_args[i] == arg
    for kwarg in kwargs:
        assert m_kwargs[kwarg] == kwargs[kwarg], (m_kwargs[kwarg], kwargs[kwarg])


def assert_commit_shape(commit):
    assert commit["id"]
    assert commit["repository"]
    assert commit["author_email"]
    assert commit["author_name"]
    assert commit["message"]
    assert commit["timestamp"]
    assert commit["patch_set"]
    patches = commit["patch_set"]
    for patch in patches:
        assert CommitFileChange.is_valid_type(patch["type"])
        assert patch["path"]


def assert_status_code(response, minimum: int, maximum: int | None = None):
    # Omit max to assert status_code == minimum.
    maximum = maximum or minimum + 1
    assert minimum <= response.status_code < maximum, (
        response.status_code,
        response.getvalue() if isinstance(response, StreamingHttpResponse) else response.content,
    )


def assert_existing_projects_status(
    org: Organization, active_project_ids: list[int], deleted_project_ids: list[int]
):
    all_projects = Project.objects.filter(organization=org).values_list("id", "status")
    active_ids = []
    deleted_or_to_be_deleted_ids = []

    for project_id, status in all_projects:
        if status == ObjectStatus.ACTIVE:
            active_ids.append(project_id)
        else:
            deleted_or_to_be_deleted_ids.append(project_id)

    assert active_ids == active_project_ids
    assert deleted_or_to_be_deleted_ids == deleted_project_ids


@assume_test_silo_mode(SiloMode.CONTROL)
def org_audit_log_exists(**kwargs):
    assert kwargs
    if "organization" in kwargs:
        kwargs["organization_id"] = kwargs.pop("organization").id
    return AuditLogEntry.objects.filter(**kwargs).exists()


def assert_org_audit_log_exists(**kwargs):
    assert org_audit_log_exists(**kwargs)


"""
Helper functions to assert integration SLO metrics
"""


def assert_halt_metric(mock_record, error_msg):
    (event_halts,) = (
        call for call in mock_record.mock_calls if call.args[0] == EventLifecycleOutcome.HALTED
    )
    if isinstance(error_msg, Exception):
        assert isinstance(event_halts.args[1], type(error_msg))
    else:
        assert event_halts.args[1] == error_msg


def assert_failure_metric(mock_record, error_msg):
    (event_failures,) = (
        call for call in mock_record.mock_calls if call.args[0] == EventLifecycleOutcome.FAILURE
    )
    if isinstance(error_msg, Exception):
        assert isinstance(event_failures.args[1], type(error_msg))
    else:
        assert event_failures.args[1] == error_msg


def assert_success_metric(mock_record):
    event_success = (
        call for call in mock_record.mock_calls if call.args[0] == EventLifecycleOutcome.SUCCESS
    )
    assert event_success


def assert_slo_metric(
    mock_record, event_outcome: EventLifecycleOutcome = EventLifecycleOutcome.SUCCESS
):
    assert len(mock_record.mock_calls) == 2
    start, end = mock_record.mock_calls
    assert start.args[0] == EventLifecycleOutcome.STARTED
    assert end.args[0] == event_outcome


def assert_slo_metric_calls(
    mock_calls, event_outcome: EventLifecycleOutcome = EventLifecycleOutcome.SUCCESS
):
    start, end = mock_calls
    assert start.args[0] == EventLifecycleOutcome.STARTED
    assert end.args[0] == event_outcome


def assert_middleware_metrics(middleware_calls):
    start1, end1, start2, end2 = middleware_calls
    assert start1.args[0] == EventLifecycleOutcome.STARTED
    assert end1.args[0] == EventLifecycleOutcome.SUCCESS
    assert start2.args[0] == EventLifecycleOutcome.STARTED
    assert end2.args[0] == EventLifecycleOutcome.SUCCESS


def assert_count_of_metric(mock_record, outcome, outcome_count):
    calls = reduce(
        lambda acc, calls: (acc + 1 if calls.args[0] == outcome else acc),
        mock_record.mock_calls,
        0,
    )
    assert calls == outcome_count


# Given messages_or_errors need to align 1:1 to the calls :bufo-big-eyes:
def assert_many_halt_metrics(mock_record, messages_or_errors):
    halts = (
        call for call in mock_record.mock_calls if call.args[0] == EventLifecycleOutcome.HALTED
    )
    for halt, error_msg in zip(halts, messages_or_errors):
        if isinstance(error_msg, Exception):
            assert isinstance(halt.args[1], type(error_msg))
        else:
            assert halt.args[1] == error_msg
