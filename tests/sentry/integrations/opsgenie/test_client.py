from unittest.mock import patch

import orjson
import pytest
import responses

from sentry.integrations.opsgenie.client import OpsgenieClient
from sentry.integrations.types import EventLifecycleOutcome
from sentry.models.rule import Rule
from sentry.testutils.asserts import assert_slo_metric
from sentry.testutils.cases import APITestCase
from sentry.testutils.helpers import with_feature
from sentry.testutils.skips import requires_snuba

pytestmark = [requires_snuba]

EXTERNAL_ID = "test-app"
METADATA = {
    "api_key": "1234-ABCD",
    "base_url": "https://api.opsgenie.com/",
    "domain_name": "test-app.app.opsgenie.com",
}


class OpsgenieClientTest(APITestCase):
    def setUp(self) -> None:
        self.login_as(self.user)
        self.integration = self.create_integration(
            organization=self.organization,
            external_id=EXTERNAL_ID,
            provider="opsgenie",
            name="test-app",
            metadata=METADATA,
            oi_params={
                "config": {
                    "team_table": [
                        {"id": "team-123", "integration_key": "1234-ABCD", "team": "default team"},
                    ]
                },
            },
        )
        self.installation = self.integration.get_installation(self.organization.id)

    def test_get_client(self):
        with pytest.raises(NotImplementedError):
            self.installation.get_client()

    def test_get_keyring_client(self):
        client = self.installation.get_keyring_client("team-123")
        assert client.integration == self.installation.model
        assert client.base_url == METADATA["base_url"] + "v2"
        assert client.integration_key == METADATA["api_key"]

    @responses.activate
    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    def test_send_notification(self, mock_record):
        resp_data = {
            "result": "Request will be processed",
            "took": 1,
            "requestId": "hello-world",
        }
        responses.add(responses.POST, url="https://api.opsgenie.com/v2/alerts", json=resp_data)

        event = self.store_event(
            data={
                "message": "Hello world",
                "level": "warning",
                "platform": "python",
                "culprit": "foo.bar",
            },
            project_id=self.project.id,
        )
        group = event.group
        assert group is not None

        rule = Rule.objects.create(project=self.project, label="my rule")
        client: OpsgenieClient = self.installation.get_keyring_client("team-123")
        with self.options({"system.url-prefix": "http://example.com"}):
            payload = client.build_issue_alert_payload(
                data=event,
                rules=[rule],
                event=event,
                group=group,
                priority="P2",
            )
            client.send_notification(payload)

        request = responses.calls[0].request
        payload = orjson.loads(request.body)
        group_id = str(group.id)
        assert payload == {
            "tags": ["level:warning"],
            "entity": "foo.bar",
            "alias": "sentry: %s" % group_id,
            "priority": "P2",
            "details": {
                "Project Name": self.project.name,
                "Triggering Rules": "my rule",
                "Triggering Rule URLs": f"http://example.com/organizations/baz/alerts/rules/{self.project.slug}/{rule.id}/details/",
                "Sentry Group": "Hello world",
                "Sentry ID": group_id,
                "Logger": "",
                "Level": "warning",
                "Project ID": "bar",
                "Issue URL": f"http://example.com/organizations/baz/issues/{group_id}/?referrer=opsgenie",
                "Release": event.release,
            },
            "message": "Hello world",
            "source": "Sentry",
        }
        assert_slo_metric(mock_record, EventLifecycleOutcome.SUCCESS)

    @responses.activate
    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @with_feature("organizations:workflow-engine-trigger-actions")
    def test_send_notification_with_workflow_engine_trigger_actions(self, mock_record):
        resp_data = {
            "result": "Request will be processed",
            "took": 1,
            "requestId": "hello-world",
        }
        responses.add(responses.POST, url="https://api.opsgenie.com/v2/alerts", json=resp_data)

        event = self.store_event(
            data={
                "message": "Hello world",
                "level": "warning",
                "platform": "python",
                "culprit": "foo.bar",
            },
            project_id=self.project.id,
        )
        group = event.group
        assert group is not None

        rule = self.create_project_rule(
            action_data=[
                {
                    "legacy_rule_id": "123",
                }
            ]
        )
        client: OpsgenieClient = self.installation.get_keyring_client("team-123")
        with self.options({"system.url-prefix": "http://example.com"}):
            payload = client.build_issue_alert_payload(
                data=event,
                rules=[rule],
                event=event,
                group=group,
                priority="P2",
            )
            client.send_notification(payload)

        request = responses.calls[0].request
        payload = orjson.loads(request.body)
        group_id = str(group.id)
        assert payload == {
            "tags": ["level:warning"],
            "entity": "foo.bar",
            "alias": "sentry: %s" % group_id,
            "priority": "P2",
            "details": {
                "Project Name": self.project.name,
                "Triggering Rules": rule.label,
                "Triggering Rule URLs": f"http://example.com/organizations/baz/alerts/rules/{self.project.slug}/{123}/details/",
                "Sentry Group": "Hello world",
                "Sentry ID": group_id,
                "Logger": "",
                "Level": "warning",
                "Project ID": "bar",
                "Issue URL": f"http://example.com/organizations/baz/issues/{group_id}/?referrer=opsgenie",
                "Release": event.release,
            },
            "message": "Hello world",
            "source": "Sentry",
        }
        assert_slo_metric(mock_record, EventLifecycleOutcome.SUCCESS)

    @responses.activate
    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @with_feature("organizations:workflow-engine-ui-links")
    def test_send_notification_with_workflow_engine_ui_links(self, mock_record):
        resp_data = {
            "result": "Request will be processed",
            "took": 1,
            "requestId": "hello-world",
        }
        responses.add(responses.POST, url="https://api.opsgenie.com/v2/alerts", json=resp_data)

        event = self.store_event(
            data={
                "message": "Hello world",
                "level": "warning",
                "platform": "python",
                "culprit": "foo.bar",
            },
            project_id=self.project.id,
        )
        group = event.group
        assert group is not None

        rule = self.create_project_rule(
            action_data=[
                {
                    "workflow_id": "123",
                }
            ]
        )
        client: OpsgenieClient = self.installation.get_keyring_client("team-123")
        with self.options({"system.url-prefix": "http://example.com"}):
            payload = client.build_issue_alert_payload(
                data=event,
                rules=[rule],
                event=event,
                group=group,
                priority="P2",
            )
            client.send_notification(payload)

        request = responses.calls[0].request
        payload = orjson.loads(request.body)
        group_id = str(group.id)
        assert payload == {
            "tags": ["level:warning"],
            "entity": "foo.bar",
            "alias": "sentry: %s" % group_id,
            "priority": "P2",
            "details": {
                "Project Name": self.project.name,
                "Triggering Workflows": rule.label,
                "Triggering Workflow URLs": f"http://example.com/organizations/{self.organization.id}/issues/automations/{123}/",
                "Sentry Group": "Hello world",
                "Sentry ID": group_id,
                "Logger": "",
                "Level": "warning",
                "Project ID": "bar",
                "Issue URL": f"http://example.com/organizations/baz/issues/{group_id}/?referrer=opsgenie",
                "Release": event.release,
            },
            "message": "Hello world",
            "source": "Sentry",
        }
        assert_slo_metric(mock_record, EventLifecycleOutcome.SUCCESS)
