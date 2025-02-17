from sentry.integrations.base import FeatureDescription, IntegrationFeatures
from sentry.plugins.bases.notify import NotificationPlugin
from sentry.shared_integrations.exceptions import ApiError
from sentry_plugins.base import CorePluginMixin
from sentry_plugins.utils import get_secret_field_config

from .client import VictorOpsClient

ENHANCED_PRIVACY_BODY = """
Details about this issue are not shown in this notification since enhanced
privacy controls are enabled. For more details about this issue, view this
issue on Sentry.
""".strip()

DESCRIPTION = """
Trigger alerts in VictorOps from Sentry.

VictorOps is incident response software purpose-built for teams powering the
evolution of software. With on-call basics, cross-team collaboration, and
streamlined visibility, we champion the engineers powering innovation and uptime.
"""


class VictorOpsPlugin(CorePluginMixin, NotificationPlugin):
    description = DESCRIPTION
    slug = "victorops"
    title = "VictorOps"
    conf_key = slug
    conf_title = title
    required_field = "api_key"
    feature_descriptions = [
        FeatureDescription(
            """
            Manage incidents and outages by sending Sentry notifications to VictorOps.
            """,
            IntegrationFeatures.INCIDENT_MANAGEMENT,
        ),
        FeatureDescription(
            """
            Configure Sentry rules to trigger notifications based on conditions you set.
            """,
            IntegrationFeatures.ALERT_RULE,
        ),
    ]

    def is_configured(self, project) -> bool:
        return bool(self.get_option("api_key", project))

    def get_config(self, project, user=None, initial=None, add_additional_fields: bool = False):
        return [
            get_secret_field_config(
                name="api_key",
                label="API Key",
                secret=self.get_option("api_key", project),
                help_text="VictorOps's Sentry API Key",
                include_prefix=True,
            ),
            {
                "name": "routing_key",
                "label": "Routing Key",
                "type": "string",
                "default": "everyone",
                "required": False,
            },
        ]

    def get_client(self, project):
        return VictorOpsClient(
            api_key=self.get_option("api_key", project),
            routing_key=self.get_option("routing_key", project),
        )

    def build_description(self, event):
        enhanced_privacy = event.organization.flags.enhanced_privacy
        if enhanced_privacy:
            return ENHANCED_PRIVACY_BODY

        interface_list = []
        for interface in event.interfaces.values():
            body = interface.to_string(event)
            if not body:
                continue
            interface_list.append((interface.get_title(), body))

        return "\n\n".join((f"{k}\n-----------\n\n{v}" for k, v in interface_list))

    def notify_users(self, group, event, triggering_rules) -> None:
        if not self.is_configured(group.project):
            return

        level = event.get_tag("level")
        if level in ("info", "debug"):
            message_type = "INFO"
        if level == "warning":
            message_type = "WARNING"
        else:
            message_type = "CRITICAL"

        client = self.get_client(group.project)
        try:
            response = client.trigger_incident(
                message_type=message_type,
                entity_id=group.id,
                entity_display_name=event.title,
                state_message=self.build_description(event),
                timestamp=int(event.datetime.strftime("%s")),
                issue_url=group.get_absolute_url(),
                issue_id=group.id,
                project_id=group.project.id,
            )
        except ApiError as e:
            self.raise_error(e)

        assert response["result"] == "success"
