from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sentry.integrations.messaging.message_builder import (
    build_attachment_text,
    build_attachment_title,
    get_title_link,
)
from sentry.integrations.msteams.card_builder import MSTEAMS_URL_FORMAT
from sentry.integrations.msteams.card_builder.base import MSTeamsMessageBuilder
from sentry.integrations.msteams.card_builder.block import OpenUrlAction
from sentry.integrations.types import ExternalProviders
from sentry.notifications.notifications.activity.base import GroupActivityNotification
from sentry.notifications.notifications.base import BaseNotification
from sentry.notifications.notifications.rules import AlertRuleNotification
from sentry.notifications.utils.actions import MessageAction
from sentry.types.actor import Actor

from .block import (
    Action,
    ActionType,
    ColumnSetBlock,
    TextBlock,
    TextSize,
    TextWeight,
    create_column_block,
    create_column_set_block,
    create_footer_column_block,
    create_footer_logo_block,
    create_footer_text_block,
    create_text_block,
)


class MSTeamsNotificationsMessageBuilder(MSTeamsMessageBuilder):
    def __init__(
        self, notification: BaseNotification, context: Mapping[str, Any], recipient: Actor
    ):
        self.notification = notification
        self.context = context
        self.recipient = recipient

    def create_footer_block(self) -> ColumnSetBlock | None:
        footer_text = self.notification.build_notification_footer(
            self.recipient, ExternalProviders.MSTEAMS
        )

        if footer_text:
            footer = create_footer_text_block(footer_text)

            return create_column_set_block(
                create_column_block(create_footer_logo_block()),
                create_footer_column_block(footer),
            )

        return None

    def create_attachment_title_block(self) -> TextBlock | None:
        title = self.notification.build_attachment_title(self.recipient)
        title_link = self.notification.get_title_link(self.recipient, ExternalProviders.MSTEAMS)

        return (
            create_text_block(
                MSTEAMS_URL_FORMAT.format(text=title, url=title_link),
                size=TextSize.LARGE,
                weight=TextWeight.BOLDER,
            )
            if title
            else None
        )

    def create_title_block(self) -> TextBlock:
        return create_text_block(
            self.notification.get_notification_title(ExternalProviders.MSTEAMS, self.context),
            size=TextSize.LARGE,
        )

    def create_description_block(self) -> TextBlock | None:
        message_description = self.notification.get_message_description(
            self.recipient, ExternalProviders.MSTEAMS
        )
        return (
            create_text_block(
                self.notification.get_message_description(
                    self.recipient, ExternalProviders.MSTEAMS
                ),
                size=TextSize.MEDIUM,
            )
            if message_description
            else None
        )

    @staticmethod
    def create_action_blocks(actions: Sequence[MessageAction]) -> list[Action]:
        action_blocks: list[Action] = []
        for action in actions:
            if not action.name or not action.url:
                raise NotImplementedError(
                    "Only actions with 'name' and 'url' attributes are supported now."
                )
            action_blocks.append(
                OpenUrlAction(type=ActionType.OPEN_URL, title=action.name, url=action.url)
            )

        return action_blocks

    def build_notification_card(self):
        fields = [self.create_attachment_title_block(), self.create_description_block()]

        # TODO: Add support for notification actions.
        return super().build(
            title=self.create_title_block(),
            fields=fields,
            footer=self.create_footer_block(),
            actions=self.create_action_blocks(
                self.notification.get_message_actions(self.recipient, ExternalProviders.MSTEAMS)
            ),
        )


class MSTeamsIssueNotificationsMessageBuilder(MSTeamsNotificationsMessageBuilder):
    def __init__(
        self,
        notification: GroupActivityNotification | AlertRuleNotification,
        context: Mapping[str, Any],
        recipient: Actor,
    ):
        super().__init__(notification, context, recipient)
        assert notification.group is not None
        self.group = notification.group

    def create_attachment_title_block(self) -> TextBlock | None:
        title = build_attachment_title(self.group)
        title_link = get_title_link(
            self.group, None, False, True, self.notification, ExternalProviders.MSTEAMS
        )

        return (
            create_text_block(
                MSTEAMS_URL_FORMAT.format(text=title, url=title_link),
                size=TextSize.LARGE,
                weight=TextWeight.BOLDER,
            )
            if title
            else None
        )

    def create_description_block(self) -> TextBlock | None:
        return (
            create_text_block(
                build_attachment_text(self.group),
                size=TextSize.MEDIUM,
            )
            if self.group
            else None
        )
