from django.urls import re_path

from sentry.workflow_engine.endpoints.organization_workflow_group_history import (
    OrganizationWorkflowGroupHistoryEndpoint,
)

from .organization_available_action_index import OrganizationAvailableActionIndexEndpoint
from .organization_data_condition_index import OrganizationDataConditionIndexEndpoint
from .organization_detector_types import OrganizationDetectorTypeIndexEndpoint
from .organization_detector_workflow_details import OrganizationDetectorWorkflowDetailsEndpoint
from .organization_detector_workflow_index import OrganizationDetectorWorkflowIndexEndpoint
from .organization_test_fire_action import OrganizationTestFireActionsEndpoint
from .organization_workflow_details import OrganizationWorkflowDetailsEndpoint
from .organization_workflow_index import OrganizationWorkflowIndexEndpoint
from .project_detector_details import ProjectDetectorDetailsEndpoint
from .project_detector_index import ProjectDetectorIndexEndpoint

# TODO @saponifi3d - Add the remaining API endpoints

# Remaining Detector Endpoints
#   - GET /detector w/ filters

# Remaining Workflows Endpoints
# - GET /workflow w/ filters
# - POST /workflow
# - PUT /workflow/:id
# - DELETE /workflow/:id

project_urlpatterns = [
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/(?P<project_id_or_slug>[^\/]+)/detectors/$",
        ProjectDetectorIndexEndpoint.as_view(),
        name="sentry-api-0-project-detector-index",
    ),
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/(?P<project_id_or_slug>[^\/]+)/detectors/(?P<detector_id>[^\/]+)/$",
        ProjectDetectorDetailsEndpoint.as_view(),
        name="sentry-api-0-project-detector-details",
    ),
]

organization_urlpatterns = [
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/workflows/$",
        OrganizationWorkflowIndexEndpoint.as_view(),
        name="sentry-api-0-organization-workflow-index",
    ),
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/workflows/(?P<workflow_id>[^\/]+)/$",
        OrganizationWorkflowDetailsEndpoint.as_view(),
        name="sentry-api-0-organization-workflow-details",
    ),
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/workflows/(?P<workflow_id>[^\/]+)/group-history$",
        OrganizationWorkflowGroupHistoryEndpoint.as_view(),
        name="sentry-api-0-organization-workflow-group-history",
    ),
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/data-conditions/$",
        OrganizationDataConditionIndexEndpoint.as_view(),
        name="sentry-api-0-organization-data-condition-index",
    ),
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/detector-types/$",
        OrganizationDetectorTypeIndexEndpoint.as_view(),
        name="sentry-api-0-organization-detector-type-index",
    ),
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/detector-workflow/$",
        OrganizationDetectorWorkflowIndexEndpoint.as_view(),
        name="sentry-api-0-organization-detector-workflow-index",
    ),
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/detector-workflow/(?P<detector_workflow_id>[^\/]+)/$",
        OrganizationDetectorWorkflowDetailsEndpoint.as_view(),
        name="sentry-api-0-organization-detector-workflow-details",
    ),
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/available-actions/$",
        OrganizationAvailableActionIndexEndpoint.as_view(),
        name="sentry-api-0-organization-available-action-index",
    ),
    re_path(
        r"^(?P<organization_id_or_slug>[^\/]+)/test-fire-actions/$",
        OrganizationTestFireActionsEndpoint.as_view(),
        name="sentry-api-0-organization-test-fire-actions",
    ),
]
