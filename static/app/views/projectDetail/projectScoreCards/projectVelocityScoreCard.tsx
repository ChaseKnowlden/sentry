import {shouldFetchPreviousPeriod} from 'sentry/components/charts/utils';
import {Button} from 'sentry/components/core/button';
import {normalizeDateTimeParams} from 'sentry/components/organizations/pageFilters/parse';
import {parseStatsPeriod} from 'sentry/components/timeRangeSelector/utils';
import {t} from 'sentry/locale';
import type {PageFilters} from 'sentry/types/core';
import type {Organization} from 'sentry/types/organization';
import {defined} from 'sentry/utils';
import {getPeriod} from 'sentry/utils/duration/getPeriod';
import {useApiQuery} from 'sentry/utils/queryClient';
import {BigNumberWidgetVisualization} from 'sentry/views/dashboards/widgets/bigNumberWidget/bigNumberWidgetVisualization';
import {Widget} from 'sentry/views/dashboards/widgets/widget/widget';
import MissingReleasesButtons from 'sentry/views/projectDetail/missingFeatureButtons/missingReleasesButtons';

import {ActionWrapper} from './actionWrapper';

const API_LIMIT = 1000;

type Release = {date: string; version: string};

const useReleaseCount = (props: Props) => {
  const {organization, selection, isProjectStabilized, query} = props;

  const isEnabled = isProjectStabilized;
  const {projects, environments, datetime} = selection;
  const {period} = datetime;

  const {start: previousStart} = parseStatsPeriod(
    getPeriod({period, start: undefined, end: undefined}, {shouldDoublePeriod: true})
      .statsPeriod!
  );

  const {start: previousEnd} = parseStatsPeriod(
    getPeriod({period, start: undefined, end: undefined}, {shouldDoublePeriod: false})
      .statsPeriod!
  );

  const commonQuery = {
    environment: environments,
    project: projects[0],
    query,
  };

  const currentQuery = useApiQuery<Release[]>(
    [
      `/organizations/${organization.slug}/releases/stats/`,
      {
        query: {
          ...commonQuery,
          ...normalizeDateTimeParams(datetime),
        },
      },
    ],
    {staleTime: Infinity, enabled: isEnabled}
  );

  const isPreviousPeriodEnabled = shouldFetchPreviousPeriod({
    start: datetime.start,
    end: datetime.end,
    period: datetime.period,
  });

  const previousQuery = useApiQuery<Release[]>(
    [
      `/organizations/${organization.slug}/releases/stats/`,
      {
        query: {
          ...commonQuery,
          start: previousStart,
          end: previousEnd,
        },
      },
    ],
    {
      staleTime: Infinity,
      enabled: isEnabled && isPreviousPeriodEnabled,
    }
  );

  const allReleases = [...(currentQuery.data ?? []), ...(previousQuery.data ?? [])];

  const isAllTimePeriodEnabled =
    !currentQuery.isPending &&
    !currentQuery.error &&
    !previousQuery.isPending &&
    !previousQuery.error &&
    allReleases.length === 0;

  const allTimeQuery = useApiQuery<Release[]>(
    [
      `/organizations/${organization.slug}/releases/stats/`,
      {
        query: {
          ...commonQuery,
          statsPeriod: '90d',
          per_page: 1,
        },
      },
    ],
    {
      staleTime: Infinity,
      enabled: isEnabled && isAllTimePeriodEnabled,
    }
  );

  return {
    data: currentQuery.data,
    previousData: previousQuery.data,
    allTimeData: allTimeQuery.data,
    isLoading:
      currentQuery.isPending ||
      (previousQuery.isPending && isPreviousPeriodEnabled) ||
      (allTimeQuery.isPending && isAllTimePeriodEnabled),
    error: currentQuery.error || previousQuery.error || allTimeQuery.error,
    refetch: () => {
      currentQuery.refetch();
      previousQuery.refetch();
      allTimeQuery.refetch();
    },
  };
};

type Props = {
  isProjectStabilized: boolean;
  organization: Organization;
  selection: PageFilters;
  query?: string;
};

function ProjectVelocityScoreCard(props: Props) {
  const {organization} = props;

  const {
    data: currentReleases,
    previousData: previousReleases,
    allTimeData: allTimeReleases,
    isLoading,
    error,
    refetch,
  } = useReleaseCount(props);

  const noReleaseEver =
    [...(currentReleases ?? []), ...(previousReleases ?? []), ...(allTimeReleases ?? [])]
      .length === 0;

  const cardTitle = t('Number of Releases');

  const cardHelp = t('The number of releases for this project.');

  const Title = <Widget.WidgetTitle title={cardTitle} />;

  if (!isLoading && noReleaseEver) {
    return (
      <Widget
        Title={<Widget.WidgetTitle title={cardTitle} />}
        Actions={
          <Widget.WidgetToolbar>
            <Widget.WidgetDescription description={cardHelp} />
          </Widget.WidgetToolbar>
        }
        Visualization={
          <ActionWrapper>
            <MissingReleasesButtons organization={organization} />
          </ActionWrapper>
        }
      />
    );
  }

  if (isLoading || !defined(currentReleases)) {
    return (
      <Widget
        Title={Title}
        Visualization={<BigNumberWidgetVisualization.LoadingPlaceholder />}
      />
    );
  }

  if (error) {
    return (
      <Widget
        Title={Title}
        Actions={
          <Widget.WidgetToolbar>
            <Button size="xs" onClick={refetch}>
              {t('Retry')}
            </Button>
          </Widget.WidgetToolbar>
        }
        Visualization={<Widget.WidgetError error={error} />}
      />
    );
  }

  return (
    <Widget
      Title={Title}
      Actions={
        <Widget.WidgetToolbar>
          <Widget.WidgetDescription description={cardHelp} />
        </Widget.WidgetToolbar>
      }
      Visualization={
        <BigNumberWidgetVisualization
          value={currentReleases?.length}
          previousPeriodValue={previousReleases?.length}
          field="count()"
          maximumValue={API_LIMIT}
          type="number"
          unit={null}
          preferredPolarity="+"
        />
      }
    />
  );
}

export default ProjectVelocityScoreCard;
