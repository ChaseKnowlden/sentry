from __future__ import annotations

import abc
import logging
from collections.abc import Callable, Collection, Iterable
from enum import Enum, IntEnum, StrEnum
from typing import TYPE_CHECKING, Any, ClassVar, Self

from django.conf import settings
from django.core.cache import cache
from django.db import models
from django.db.models.signals import post_delete, post_save, pre_delete
from django.utils import timezone
from django.utils.translation import gettext_lazy

from sentry.backup.scopes import RelocationScope
from sentry.constants import ObjectStatus
from sentry.db.models import (
    BoundedPositiveIntegerField,
    FlexibleForeignKey,
    JSONField,
    Model,
    region_silo_model,
    sane_repr,
)
from sentry.db.models.fields.hybrid_cloud_foreign_key import HybridCloudForeignKey
from sentry.db.models.manager.base import BaseManager
from sentry.db.models.manager.base_query_set import BaseQuerySet
from sentry.incidents.models.incident import Incident, IncidentStatus, IncidentTrigger
from sentry.models.organization import Organization
from sentry.models.organizationmember import OrganizationMember
from sentry.models.project import Project
from sentry.models.team import Team
from sentry.notifications.models.notificationaction import (
    AbstractNotificationAction,
    ActionService,
    ActionTarget,
)
from sentry.seer.anomaly_detection.delete_rule import delete_rule_in_seer
from sentry.snuba.models import QuerySubscription
from sentry.types.actor import Actor
from sentry.utils import metrics

if TYPE_CHECKING:
    from sentry.incidents.action_handlers import ActionHandler


logger = logging.getLogger(__name__)


class AlertRuleStatus(Enum):
    PENDING = 0
    SNAPSHOT = 4
    DISABLED = 5
    NOT_ENOUGH_DATA = 6


class AlertRuleDetectionType(models.TextChoices):
    STATIC = "static", gettext_lazy("Static")
    PERCENT = "percent", gettext_lazy("Percent")
    DYNAMIC = "dynamic", gettext_lazy("Dynamic")


class AlertRuleSensitivity(models.TextChoices):
    LOW = "low", gettext_lazy("Low")
    MEDIUM = "medium", gettext_lazy("Medium")
    HIGH = "high", gettext_lazy("High")


class AlertRuleSeasonality(models.TextChoices):
    """All combinations of multi select fields for anomaly detection alerts
    We do not anticipate adding more
    """

    AUTO = "auto", gettext_lazy("Auto")
    HOURLY = "hourly", gettext_lazy("Hourly")
    DAILY = "daily", gettext_lazy("Daily")
    WEEKLY = "weekly", gettext_lazy("Weekly")
    HOURLY_DAILY = "hourly_daily", gettext_lazy("Hourly & Daily")
    HOURLY_WEEKLY = "hourly_weekly", gettext_lazy("Hourly & Weekly")
    HOURLY_DAILY_WEEKLY = "hourly_daily_weekly", gettext_lazy("Hourly, Daily, & Weekly")
    DAILY_WEEKLY = "daily_weekly", gettext_lazy("Daily & Weekly")


class AlertRuleManager(BaseManager["AlertRule"]):
    """
    A manager that excludes all rows that are snapshots.
    """

    CACHE_SUBSCRIPTION_KEY = "alert_rule:subscription:%s"

    def get_queryset(self) -> BaseQuerySet[AlertRule]:
        return super().get_queryset().exclude(status=AlertRuleStatus.SNAPSHOT.value)

    def fetch_for_organization(
        self, organization: Organization, projects: Collection[Project] | None = None
    ):
        queryset = self.filter(organization=organization)
        if projects is not None:
            queryset = queryset.filter(projects__in=projects).distinct()

        return queryset

    def fetch_for_project(self, project: Project) -> BaseQuerySet[AlertRule]:
        return self.filter(projects=project).distinct()

    @classmethod
    def __build_subscription_cache_key(cls, subscription_id: int) -> str:
        return cls.CACHE_SUBSCRIPTION_KEY % subscription_id

    def get_for_subscription(self, subscription: Model) -> AlertRule:
        """
        Fetches the AlertRule associated with a Subscription. Attempts to fetch from
        cache then hits the database
        """
        cache_key = self.__build_subscription_cache_key(subscription.id)
        alert_rule = cache.get(cache_key)
        if alert_rule is None:
            alert_rule = AlertRule.objects.get(snuba_query__subscriptions=subscription)
            cache.set(cache_key, alert_rule, 3600)

        return alert_rule

    @classmethod
    def clear_subscription_cache(cls, instance, **kwargs: Any) -> None:
        cache.delete(cls.__build_subscription_cache_key(instance.id))
        assert cache.get(cls.__build_subscription_cache_key(instance.id)) is None

    @classmethod
    def clear_alert_rule_subscription_caches(cls, instance: AlertRule, **kwargs: Any) -> None:
        subscription_ids = QuerySubscription.objects.filter(
            snuba_query_id=instance.snuba_query_id
        ).values_list("id", flat=True)
        if subscription_ids:
            cache.delete_many(
                cls.__build_subscription_cache_key(sub_id) for sub_id in subscription_ids
            )
            assert all(
                cache.get(cls.__build_subscription_cache_key(sub_id)) is None
                for sub_id in subscription_ids
            )

    @classmethod
    def delete_data_in_seer(cls, instance: AlertRule, **kwargs: Any) -> None:
        if instance.detection_type == AlertRuleDetectionType.DYNAMIC:
            success = delete_rule_in_seer(alert_rule=instance)
            if not success:
                logger.error(
                    "Call to delete rule data in Seer failed",
                    extra={
                        "rule_id": instance.id,
                    },
                )

    @classmethod
    def dual_delete_alert_rule(cls, instance: AlertRule, **kwargs: Any) -> None:
        from sentry.workflow_engine.migration_helpers.alert_rule import (
            dual_delete_migrated_alert_rule,
        )

        try:
            dual_delete_migrated_alert_rule(instance)
        except Exception as e:
            logger.exception(
                "Error when dual deleting alert rule",
                extra={
                    "rule_id": instance.id,
                    "error": str(e),
                },
            )


@region_silo_model
class AlertRuleProjects(Model):
    """
    Specify a project for the AlertRule
    """

    __relocation_scope__ = RelocationScope.Organization

    alert_rule = FlexibleForeignKey("sentry.AlertRule", db_index=False)
    project = FlexibleForeignKey("sentry.Project")
    date_added = models.DateTimeField(default=timezone.now)

    class Meta:
        app_label = "sentry"
        db_table = "sentry_alertruleprojects"
        unique_together = (("alert_rule", "project"),)


class AlertRuleMonitorTypeInt(IntEnum):
    CONTINUOUS = 0
    ACTIVATED = 1


class ComparisonDeltaChoices(models.IntegerChoices):
    FIVE_MINUTES = (300, "5 minutes ago")
    FIFTEEN_MINUTES = (900, "15 minutes ago")
    ONE_HOUR = (3600, "1 hour ago")
    ONE_DAY = (86400, "1 day ago")
    ONE_WEEK = (604800, "1 week ago")
    ONE_MONTH = (2592000, "1 month ago")


@region_silo_model
class AlertRule(Model):
    __relocation_scope__ = RelocationScope.Organization

    objects: ClassVar[AlertRuleManager] = AlertRuleManager()
    objects_with_snapshots: ClassVar[BaseManager[Self]] = BaseManager()

    organization = FlexibleForeignKey("sentry.Organization")
    # NOTE: for now AlertRules and Projects should be 1:1
    # We do not have multi-project alert rules yet
    projects = models.ManyToManyField(
        "sentry.Project", related_name="alert_rule_projects", through=AlertRuleProjects
    )
    snuba_query = FlexibleForeignKey("sentry.SnubaQuery", unique=True)

    user_id = HybridCloudForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete="SET_NULL")
    team = FlexibleForeignKey("sentry.Team", null=True, on_delete=models.SET_NULL)
    name = models.TextField()
    status = models.SmallIntegerField(
        default=AlertRuleStatus.PENDING.value, db_default=AlertRuleStatus.PENDING.value
    )
    threshold_type = models.SmallIntegerField(null=True)
    resolve_threshold = models.FloatField(null=True)
    # How many times an alert value must exceed the threshold to fire/resolve the alert
    threshold_period = models.IntegerField()
    # This represents a time delta, in seconds. If not null, this is used to determine which time
    # window to query to compare the result from the current time_window to.
    comparison_delta = models.IntegerField(choices=ComparisonDeltaChoices.choices, null=True)
    date_modified = models.DateTimeField(default=timezone.now)
    date_added = models.DateTimeField(default=timezone.now)
    monitor_type = models.IntegerField(
        default=AlertRuleMonitorTypeInt.CONTINUOUS, db_default=AlertRuleMonitorTypeInt.CONTINUOUS
    )
    description = models.CharField(max_length=1000, null=True)
    detection_type = models.CharField(
        default=AlertRuleDetectionType.STATIC,
        db_default=AlertRuleDetectionType.STATIC,
        choices=AlertRuleDetectionType.choices,
    )
    sensitivity = models.CharField(choices=AlertRuleSensitivity.choices, null=True)
    seasonality = models.CharField(choices=AlertRuleSeasonality.choices, null=True)

    class Meta:
        app_label = "sentry"
        db_table = "sentry_alertrule"
        base_manager_name = "objects_with_snapshots"
        default_manager_name = "objects_with_snapshots"

    __repr__ = sane_repr("id", "name", "date_added")

    @property
    def created_by_id(self) -> int | None:
        try:
            created_activity = AlertRuleActivity.objects.get(
                alert_rule=self, type=AlertRuleActivityType.CREATED.value
            )
            return created_activity.user_id
        except AlertRuleActivity.DoesNotExist:
            pass
        return None

    @property
    def owner(self) -> Actor | None:
        """Part of ActorOwned Protocol"""
        return Actor.from_id(user_id=self.user_id, team_id=self.team_id)

    @owner.setter
    def owner(self, actor: Actor | None) -> None:
        """Part of ActorOwned Protocol"""
        self.team_id = None
        self.user_id = None
        if actor and actor.is_user:
            self.user_id = actor.id
        if actor and actor.is_team:
            self.team_id = actor.id

    def get_audit_log_data(self) -> dict[str, Any]:
        return {"label": self.name}


class AlertRuleTriggerManager(BaseManager["AlertRuleTrigger"]):
    CACHE_KEY = "alert_rule_triggers:alert_rule:%s"

    @classmethod
    def _build_trigger_cache_key(cls, alert_rule_id: int) -> str:
        return cls.CACHE_KEY % alert_rule_id

    def get_for_alert_rule(self, alert_rule: AlertRule) -> list[AlertRuleTrigger]:
        """
        Fetches the AlertRuleTriggers associated with an AlertRule. Attempts to fetch
        from cache then hits the database
        """
        cache_key = self._build_trigger_cache_key(alert_rule.id)
        triggers = cache.get(cache_key)
        if triggers is None:
            triggers = list(AlertRuleTrigger.objects.filter(alert_rule=alert_rule))
            cache.set(cache_key, triggers, 3600)
        return triggers

    @classmethod
    def clear_trigger_cache(cls, instance: AlertRuleTrigger, **kwargs: Any) -> None:
        cache.delete(cls._build_trigger_cache_key(instance.alert_rule_id))
        assert cache.get(cls._build_trigger_cache_key(instance.alert_rule_id)) is None

    @classmethod
    def clear_alert_rule_trigger_cache(cls, instance: AlertRuleTrigger, **kwargs: Any) -> None:
        cache.delete(cls._build_trigger_cache_key(instance.id))
        assert cache.get(cls._build_trigger_cache_key(instance.id)) is None


class AlertRuleThresholdType(Enum):
    ABOVE = 0
    BELOW = 1
    ABOVE_AND_BELOW = 2


@region_silo_model
class AlertRuleTrigger(Model):
    """
    This model represents the *threshold* trigger for an AlertRule

    threshold_type is AlertRuleThresholdType (Above/Below)
    alert_threshold is the trigger value
    """

    __relocation_scope__ = RelocationScope.Organization

    alert_rule = FlexibleForeignKey("sentry.AlertRule")
    label = models.TextField()
    threshold_type = models.SmallIntegerField(null=True)
    alert_threshold = models.FloatField()
    resolve_threshold = models.FloatField(null=True)
    triggered_incidents = models.ManyToManyField(
        "sentry.Incident", related_name="triggers", through=IncidentTrigger
    )
    date_added = models.DateTimeField(default=timezone.now)

    objects: ClassVar[AlertRuleTriggerManager] = AlertRuleTriggerManager()

    class Meta:
        app_label = "sentry"
        db_table = "sentry_alertruletrigger"
        unique_together = (("alert_rule", "label"),)


class AlertRuleTriggerActionMethod(StrEnum):
    FIRE = "fire"
    RESOLVE = "resolve"


class AlertRuleTriggerActionManager(BaseManager["AlertRuleTriggerAction"]):
    """
    A manager that excludes trigger actions that are pending to be deleted
    """

    def get_queryset(self) -> BaseQuerySet[AlertRuleTriggerAction]:
        return super().get_queryset().exclude(status=ObjectStatus.PENDING_DELETION)


class ActionHandlerFactory(abc.ABC):
    """A factory for action handlers tied to a specific incident service.

    The factory's builder method is augmented with metadata about which service it is
    for and which target types that service supports.
    """

    def __init__(
        self,
        slug: str,
        service_type: ActionService,
        supported_target_types: Iterable[ActionTarget],
        integration_provider: str | None,
    ) -> None:
        self.slug = slug
        self.service_type = service_type
        self.supported_target_types = frozenset(supported_target_types)
        self.integration_provider = integration_provider

    @abc.abstractmethod
    def build_handler(self) -> ActionHandler:
        raise NotImplementedError


class _AlertRuleActionHandlerClassFactory(ActionHandlerFactory):
    """A factory derived from a concrete ActionHandler class.

    The factory builds a handler simply by instantiating the provided class. The
    `AlertRuleTriggerAction.register_type` decorator provides the rest of the metadata.
    """

    def __init__(
        self,
        slug: str,
        service_type: ActionService,
        supported_target_types: Iterable[ActionTarget],
        integration_provider: str | None,
        trigger_action_class: type[ActionHandler],
    ) -> None:
        super().__init__(slug, service_type, supported_target_types, integration_provider)
        self.trigger_action_class = trigger_action_class

    def build_handler(self) -> ActionHandler:
        return self.trigger_action_class()


class _FactoryRegistry:
    def __init__(self) -> None:
        # Two kinds of index. The value sets should be equal at all times.
        self.by_action_service: dict[ActionService, ActionHandlerFactory] = {}
        self.by_slug: dict[str, ActionHandlerFactory] = {}

    def register(self, factory: ActionHandlerFactory) -> None:
        if factory.service_type in self.by_action_service:
            raise Exception(f"Handler already registered for type {factory.service_type}")
        if factory.slug in self.by_slug:
            raise Exception(f"Handler already registered with slug={factory.slug!r}")
        self.by_action_service[factory.service_type] = factory
        self.by_slug[factory.slug] = factory


@region_silo_model
class AlertRuleTriggerAction(AbstractNotificationAction):
    """
    This model represents an action that occurs when a trigger (over/under) is fired. This is
    typically some sort of notification.

    NOTE: AlertRuleTrigger is the 'threshold' for the AlertRule
    """

    __relocation_scope__ = RelocationScope.Global

    Type = ActionService
    TargetType = ActionTarget

    # As a test utility, TemporaryAlertRuleTriggerActionRegistry has privileged
    # access to this otherwise private class variable
    _factory_registrations = _FactoryRegistry()

    INTEGRATION_TYPES = frozenset(
        (
            Type.PAGERDUTY.value,
            Type.SLACK.value,
            Type.MSTEAMS.value,
            Type.OPSGENIE.value,
            Type.DISCORD.value,
        )
    )

    # ActionService items which are not supported for AlertRuleTriggerActions
    EXEMPT_SERVICES = frozenset((Type.SENTRY_NOTIFICATION.value,))

    objects: ClassVar[AlertRuleTriggerActionManager] = AlertRuleTriggerActionManager()
    objects_for_deletion: ClassVar[BaseManager] = BaseManager()

    alert_rule_trigger = FlexibleForeignKey("sentry.AlertRuleTrigger")

    date_added = models.DateTimeField(default=timezone.now)
    sentry_app_config: models.Field[
        # list of dicts if this is a sentry app, otherwise can be singular dict
        dict[str, Any] | list[dict[str, Any]] | None,
        dict[str, Any] | list[dict[str, Any]] | None,
    ] = JSONField(null=True)
    status = BoundedPositiveIntegerField(
        default=ObjectStatus.ACTIVE, choices=ObjectStatus.as_choices()
    )

    class Meta:
        app_label = "sentry"
        db_table = "sentry_alertruletriggeraction"

    @property
    def target(self) -> OrganizationMember | Team | str | None:
        if self.target_identifier is None:
            return None

        if self.target_type == self.TargetType.USER.value:
            try:
                return OrganizationMember.objects.get(
                    user_id=int(self.target_identifier),
                    organization=self.alert_rule_trigger.alert_rule.organization_id,
                )
            except OrganizationMember.DoesNotExist:
                pass

        elif self.target_type == self.TargetType.TEAM.value:
            try:
                return Team.objects.get(id=int(self.target_identifier))
            except Team.DoesNotExist:
                pass

        elif self.target_type == self.TargetType.SPECIFIC.value:
            # TODO: This is only for email. We should have a way of validating that it's
            # ok to contact this email.
            return self.target_identifier
        return None

    @staticmethod
    def build_handler(type: ActionService) -> ActionHandler | None:
        factory = AlertRuleTriggerAction._factory_registrations.by_action_service.get(type)
        if factory is not None:
            return factory.build_handler()
        else:
            metrics.incr(f"alert_rule_trigger.unhandled_type.{type}")
            return None

    def fire(
        self,
        action: AlertRuleTriggerAction,
        incident: Incident,
        project: Project,
        metric_value: int | float | None,
        new_status: IncidentStatus,
        notification_uuid: str | None = None,
    ) -> None:
        handler = AlertRuleTriggerAction.build_handler(AlertRuleTriggerAction.Type(self.type))
        if handler:
            return handler.fire(
                action=action,
                incident=incident,
                project=project,
                new_status=new_status,
                metric_value=metric_value,
                notification_uuid=notification_uuid,
            )

    def resolve(
        self,
        action: AlertRuleTriggerAction,
        incident: Incident,
        project: Project,
        metric_value: int | float | None,
        new_status: IncidentStatus,
        notification_uuid: str | None = None,
    ) -> None:
        handler = AlertRuleTriggerAction.build_handler(AlertRuleTriggerAction.Type(self.type))
        if handler:
            return handler.resolve(
                action=action,
                incident=incident,
                project=project,
                metric_value=metric_value,
                new_status=new_status,
                notification_uuid=notification_uuid,
            )

    def get_single_sentry_app_config(self) -> dict[str, Any] | None:
        value = self.sentry_app_config
        if isinstance(value, list):
            raise ValueError("Sentry app actions have a list of configs")
        return value

    @classmethod
    def register_factory(cls, factory: ActionHandlerFactory) -> None:
        cls._factory_registrations.register(factory)

    @classmethod
    def register_type(
        cls,
        slug: str,
        service_type: ActionService,
        supported_target_types: Collection[ActionTarget],
        integration_provider: str | None = None,
    ) -> Callable[[type[ActionHandler]], type[ActionHandler]]:
        """
        Register a factory for the decorated ActionHandler class, for a given service type.

        :param slug: A string representing the name of this type registration
        :param service_type: The action service type the decorated handler supports.
        :param supported_target_types: The target types the decorated handler supports.
        :param integration_provider: String representing the integration provider
               related to this type.
        """

        def inner(handler: type[ActionHandler]) -> type[ActionHandler]:
            """
            :param handler: A subclass of `ActionHandler` that accepts the
                            `AlertRuleActionHandler` and `Incident`.
            """
            factory = _AlertRuleActionHandlerClassFactory(
                slug, service_type, supported_target_types, integration_provider, handler
            )
            cls.register_factory(factory)
            return handler

        return inner

    @classmethod
    def get_registered_factory(cls, service_type: ActionService) -> ActionHandlerFactory:
        return cls._factory_registrations.by_action_service[service_type]

    @classmethod
    def get_registered_factories(cls) -> list[ActionHandlerFactory]:
        return list(cls._factory_registrations.by_action_service.values())

    @classmethod
    def look_up_factory_by_slug(cls, slug: str) -> ActionHandlerFactory | None:
        return cls._factory_registrations.by_slug.get(slug)

    @classmethod
    def get_all_slugs(cls) -> list[str]:
        return list(cls._factory_registrations.by_slug)


class AlertRuleActivityType(Enum):
    CREATED = 1
    DELETED = 2
    UPDATED = 3
    ENABLED = 4
    DISABLED = 5
    SNAPSHOT = 6
    ACTIVATED = 7
    DEACTIVATED = 8


@region_silo_model
class AlertRuleActivity(Model):
    """
    Provides an audit log of activity for the alert rule
    """

    __relocation_scope__ = RelocationScope.Organization

    alert_rule = FlexibleForeignKey("sentry.AlertRule")
    previous_alert_rule = FlexibleForeignKey(
        "sentry.AlertRule", null=True, related_name="previous_alert_rule"
    )
    user_id = HybridCloudForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete="SET_NULL")
    type = models.IntegerField()
    date_added = models.DateTimeField(default=timezone.now)

    class Meta:
        app_label = "sentry"
        db_table = "sentry_alertruleactivity"


pre_delete.connect(AlertRuleManager.dual_delete_alert_rule, sender=AlertRule)

post_delete.connect(AlertRuleManager.clear_subscription_cache, sender=QuerySubscription)
post_delete.connect(AlertRuleManager.delete_data_in_seer, sender=AlertRule)
post_save.connect(AlertRuleManager.clear_subscription_cache, sender=QuerySubscription)
post_save.connect(AlertRuleManager.clear_alert_rule_subscription_caches, sender=AlertRule)
post_delete.connect(AlertRuleManager.clear_alert_rule_subscription_caches, sender=AlertRule)

post_delete.connect(AlertRuleTriggerManager.clear_alert_rule_trigger_cache, sender=AlertRule)
post_save.connect(AlertRuleTriggerManager.clear_alert_rule_trigger_cache, sender=AlertRule)
post_save.connect(AlertRuleTriggerManager.clear_trigger_cache, sender=AlertRuleTrigger)
post_delete.connect(AlertRuleTriggerManager.clear_trigger_cache, sender=AlertRuleTrigger)
