import styled from '@emotion/styled';

import {defined} from 'sentry/utils';
import {
  WidgetFrame,
  type WidgetFrameProps,
} from 'sentry/views/dashboards/widgets/common/widgetFrame';
import {
  TimeSeriesWidgetVisualization,
  type TimeSeriesWidgetVisualizationProps,
} from 'sentry/views/dashboards/widgets/timeSeriesWidget/timeSeriesWidgetVisualization';

import {MISSING_DATA_MESSAGE, X_GUTTER, Y_GUTTER} from '../common/settings';
import type {StateProps} from '../common/types';
import {LoadingPanel} from '../widgetLayout/loadingPanel';

export interface TimeSeriesWidgetProps
  extends StateProps,
    Omit<WidgetFrameProps, 'children'>,
    Partial<TimeSeriesWidgetVisualizationProps> {
  visualizationType: TimeSeriesWidgetVisualizationProps['visualizationType'];
}

export function TimeSeriesWidget(props: TimeSeriesWidgetProps) {
  const {timeseries} = props;

  if (props.isLoading) {
    return (
      <WidgetFrame title={props.title} description={props.description}>
        <LoadingPanel />
      </WidgetFrame>
    );
  }

  let parsingError: string | undefined = undefined;

  if (!defined(timeseries)) {
    parsingError = MISSING_DATA_MESSAGE;
  }

  const error = props.error ?? parsingError;

  return (
    <WidgetFrame
      title={props.title}
      description={props.description}
      actions={props.actions}
      actionsDisabled={props.actionsDisabled}
      actionsMessage={props.actionsMessage}
      badgeProps={props.badgeProps}
      onFullScreenViewClick={props.onFullScreenViewClick}
      warnings={props.warnings}
      error={error}
      onRetry={props.onRetry}
    >
      {defined(timeseries) && (
        <TimeSeriesWrapper>
          <TimeSeriesWidgetVisualization
            visualizationType={props.visualizationType}
            timeseries={timeseries}
            releases={props.releases}
            aliases={props.aliases}
            dataCompletenessDelay={props.dataCompletenessDelay}
            timeseriesSelection={props.timeseriesSelection}
            onTimeseriesSelectionChange={props.onTimeseriesSelectionChange}
          />
        </TimeSeriesWrapper>
      )}
    </WidgetFrame>
  );
}

const TimeSeriesWrapper = styled('div')`
  flex-grow: 1;
  padding: 0 ${X_GUTTER} ${Y_GUTTER} ${X_GUTTER};
`;
