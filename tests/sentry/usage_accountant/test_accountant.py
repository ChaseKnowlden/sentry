from unittest import mock

from arroyo.backends.kafka.consumer import KafkaPayload
from arroyo.backends.local.backend import LocalBroker
from arroyo.backends.local.storages.memory import MemoryMessageStorage
from arroyo.types import BrokerValue, Partition, Topic
from usageaccountant import UsageUnit

from sentry.testutils.helpers.options import override_options
from sentry.testutils.helpers.usage_accountant import usage_accountant_backend
from sentry.testutils.pytest.fixtures import django_db_all
from sentry.usage_accountant import record
from sentry.utils.json import loads


def assert_msg(
    message: BrokerValue[KafkaPayload] | None,
    timestamp: int,
    resource_id: str,
    app_feature: str,
    amount: int,
    usage_type: UsageUnit,
) -> None:
    assert message is not None
    payload = message.payload
    assert payload is not None
    formatted = loads(payload.value.decode("utf-8"))
    assert formatted == {
        "timestamp": timestamp,
        "shared_resource_id": resource_id,
        "app_feature": app_feature,
        "usage_unit": usage_type.value,
        "amount": amount,
    }


@django_db_all
@mock.patch("time.time")
def test_accountant(mock_time: mock.Mock) -> None:
    storage: MemoryMessageStorage[KafkaPayload] = MemoryMessageStorage()
    broker = LocalBroker(storage)
    topic = Topic("shared-resources-usage")
    broker.create_topic(topic, 1)
    producer = broker.get_producer()

    with (
        override_options({"shared_resources_accounting_enabled": ["resource_1"]}),
        usage_accountant_backend(producer),
    ):
        mock_time.return_value = 1594839910.1
        record("resource_1", "feature_1", 100, UsageUnit.BYTES)
        record("resource_1", "feature_2", 100, UsageUnit.BYTES)

    msg1 = broker.consume(Partition(topic, 0), 0)
    assert_msg(
        msg1,
        1594839900,
        "resource_1",
        "feature_1",
        100,
        UsageUnit.BYTES,
    )
    msg2 = broker.consume(Partition(topic, 0), 1)
    assert_msg(
        msg2,
        1594839900,
        "resource_1",
        "feature_2",
        100,
        UsageUnit.BYTES,
    )
