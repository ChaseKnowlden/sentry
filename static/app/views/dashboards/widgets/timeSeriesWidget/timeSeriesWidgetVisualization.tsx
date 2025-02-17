import {useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTheme} from '@emotion/react';
import type {BarSeriesOption, LineSeriesOption} from 'echarts';
import type {
  TooltipFormatterCallback,
  TopLevelFormatterParams,
} from 'echarts/types/dist/shared';
import type EChartsReactCore from 'echarts-for-react/lib/core';

import BaseChart from 'sentry/components/charts/baseChart';
import {getFormatter} from 'sentry/components/charts/components/tooltip';
import LineSeries from 'sentry/components/charts/series/lineSeries';
import {useChartZoom} from 'sentry/components/charts/useChartZoom';
import {isChartHovered} from 'sentry/components/charts/utils';
import type {Series} from 'sentry/types/echarts';
import {defined} from 'sentry/utils';
import {uniq} from 'sentry/utils/array/uniq';
import type {
  AggregationOutputType,
  DurationUnit,
  RateUnit,
  SizeUnit,
} from 'sentry/utils/discover/fields';
import normalizeUrl from 'sentry/utils/url/normalizeUrl';
import useOrganization from 'sentry/utils/useOrganization';
import usePageFilters from 'sentry/utils/usePageFilters';

import {useWidgetSyncContext} from '../../contexts/widgetSyncContext';
import {AreaChartWidgetSeries} from '../areaChartWidget/areaChartWidgetSeries';
import {BarChartWidgetSeries} from '../barChartWidget/barChartWidgetSeries';
import type {
  Aliases,
  Release,
  TimeseriesData,
  TimeseriesSelection,
} from '../common/types';
import {LineChartWidgetSeries} from '../lineChartWidget/lineChartWidgetSeries';

import {formatTooltipValue} from './formatTooltipValue';
import {formatYAxisValue} from './formatYAxisValue';
import {markDelayedData} from './markDelayedData';
import {ReleaseSeries} from './releaseSeries';
import {scaleTimeSeriesData} from './scaleTimeSeriesData';
import {FALLBACK_TYPE, FALLBACK_UNIT_FOR_FIELD_TYPE} from './settings';
import {splitSeriesIntoCompleteAndIncomplete} from './splitSeriesIntoCompleteAndIncomplete';

type VisualizationType = 'area' | 'line' | 'bar';

type SeriesConstructor = (
  timeserie: TimeseriesData,
  complete?: boolean
) => LineSeriesOption | BarSeriesOption;

export interface TimeSeriesWidgetVisualizationProps {
  timeseries: TimeseriesData[];
  visualizationType: VisualizationType;
  aliases?: Aliases;
  dataCompletenessDelay?: number;
  onTimeseriesSelectionChange?: (selection: TimeseriesSelection) => void;
  releases?: Release[];
  timeseriesSelection?: TimeseriesSelection;
}

export function TimeSeriesWidgetVisualization(props: TimeSeriesWidgetVisualizationProps) {
  const chartRef = useRef<EChartsReactCore | null>(null);
  const {register: registerWithWidgetSyncContext} = useWidgetSyncContext();

  const pageFilters = usePageFilters();
  const {start, end, period, utc} = pageFilters.selection.datetime;

  const dataCompletenessDelay = props.dataCompletenessDelay ?? 0;

  const theme = useTheme();
  const organization = useOrganization();
  const navigate = useNavigate();

  let releaseSeries: Series | undefined = undefined;
  if (props.releases) {
    const onClick = (release: Release) => {
      navigate(
        normalizeUrl({
          pathname: `/organizations/${
            organization.slug
          }/releases/${encodeURIComponent(release.version)}/`,
        })
      );
    };

    releaseSeries = ReleaseSeries(theme, props.releases, onClick, utc ?? false);
  }

  const formatSeriesName: (string: string) => string = name => {
    return props.aliases?.[name] ?? name;
  };

  const chartZoomProps = useChartZoom({
    saveOnZoom: true,
  });

  // TODO: The `meta.fields` property should be typed as
  // Record<string, AggregationOutputType | null>, which is the reality
  let yAxisFieldType: AggregationOutputType;

  const types = uniq(
    props.timeseries.map(timeserie => {
      return timeserie?.meta?.fields?.[timeserie.field];
    })
  ).filter(Boolean) as AggregationOutputType[];

  if (types.length === 1) {
    // All timeseries have the same type. Use that as the Y axis type.
    yAxisFieldType = types[0]!;
  } else {
    // Types are mismatched or missing. Use a fallback type
    yAxisFieldType = FALLBACK_TYPE;
  }

  let yAxisUnit: DurationUnit | SizeUnit | RateUnit | null;

  const units = uniq(
    props.timeseries.map(timeserie => {
      return timeserie?.meta?.units?.[timeserie.field];
    })
  ) as Array<DurationUnit | SizeUnit | RateUnit | null>;

  if (units.length === 1) {
    // All timeseries have the same unit. Use that unit. This is especially
    // important for named rate timeseries like `"epm()"` where the user would
    // expect a plot in minutes
    yAxisUnit = units[0]!;
  } else {
    // None of the series specified a unit, or there are mismatched units. Fall
    // back to an appropriate unit for the axis type
    yAxisUnit = FALLBACK_UNIT_FOR_FIELD_TYPE[yAxisFieldType];
  }

  const scaledSeries = props.timeseries.map(timeserie => {
    return scaleTimeSeriesData(timeserie, yAxisUnit);
  });

  let completeSeries: TimeseriesData[] = scaledSeries;
  const incompleteSeries: TimeseriesData[] = [];

  if (dataCompletenessDelay > 0 && ['line', 'area'].includes(props.visualizationType)) {
    // In order to show incomplete data for line and area series, we have to do
    // a shenanigan in which we split the series into two, style the
    // "incomplete" series differently, and show both series on the chart
    completeSeries = [];

    scaledSeries.forEach(timeserie => {
      const [completeSerie, incompleteSerie] = splitSeriesIntoCompleteAndIncomplete(
        timeserie,
        dataCompletenessDelay
      );

      if (completeSerie && completeSerie.data.length > 0) {
        completeSeries.push(completeSerie);
      }

      if (incompleteSerie && incompleteSerie.data.length > 0) {
        incompleteSeries.push(incompleteSerie);
      }
    });
  } else if (dataCompletenessDelay > 0 && props.visualizationType === 'bar') {
    // Bar charts are not continuous (there are gaps between the bars) so no
    // shenanigan is needed. Simply mark the "incomplete" bars
    completeSeries = props.timeseries.map(timeserie => {
      return markDelayedData(timeserie, dataCompletenessDelay);
    });
  }

  const formatTooltip: TooltipFormatterCallback<TopLevelFormatterParams> = (
    params,
    asyncTicket
  ) => {
    // Only show the tooltip of the current chart. Otherwise, all tooltips
    // in the chart group appear.
    if (!isChartHovered(chartRef?.current)) {
      return '';
    }

    let deDupedParams = params;

    if (Array.isArray(params)) {
      // We split each series into a complete and incomplete series, and they
      // have the same name. The two series overlap at one point on the chart,
      // to create a continuous line. This code prevents both series from
      // showing up on the tooltip
      const uniqueSeries = new Set<string>();

      deDupedParams = params.filter(param => {
        // Filter null values from tooltip
        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        if (param.value[1] === null) {
          return false;
        }

        // @ts-expect-error TS(2345): Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
        if (uniqueSeries.has(param.seriesName)) {
          return false;
        }

        // @ts-expect-error TS(2345): Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
        uniqueSeries.add(param.seriesName);
        return true;
      });
    }

    return getFormatter({
      isGroupedByDate: true,
      showTimeInTooltip: true,
      valueFormatter: (value, field) => {
        if (!field) {
          return formatTooltipValue(value, FALLBACK_TYPE);
        }

        const timeserie = scaledSeries.find(t => t.field === field);

        return formatTooltipValue(
          value,
          timeserie?.meta?.fields?.[field] ?? FALLBACK_TYPE,
          timeserie?.meta?.units?.[field] ?? undefined
        );
      },
      nameFormatter: formatSeriesName,
      truncate: true,
      utc: utc ?? false,
    })(deDupedParams, asyncTicket);
  };

  let visibleSeriesCount = scaledSeries.length;
  if (releaseSeries) {
    visibleSeriesCount += 1;
  }

  const showLegend = visibleSeriesCount > 1;

  const SeriesConstructor = SeriesConstructors[props.visualizationType];

  return (
    <BaseChart
      ref={e => {
        chartRef.current = e;

        if (e?.getEchartsInstance) {
          registerWithWidgetSyncContext(e.getEchartsInstance());
        }
      }}
      autoHeightResize
      series={[
        ...completeSeries.map(timeserie => {
          return SeriesConstructor(timeserie, true);
        }),
        ...incompleteSeries.map(timeserie => {
          return SeriesConstructor(timeserie, false);
        }),
        releaseSeries &&
          LineSeries({
            ...releaseSeries,
            name: releaseSeries.seriesName,
            data: [],
          }),
      ].filter(defined)}
      grid={{
        left: 0,
        top: showLegend ? 25 : 10,
        right: 4,
        bottom: 0,
        containLabel: true,
      }}
      legend={
        showLegend
          ? {
              top: 0,
              left: 0,
              formatter(name: string) {
                return props.aliases?.[name] ?? formatSeriesName(name);
              },
              selected: props.timeseriesSelection,
            }
          : undefined
      }
      onLegendSelectChanged={event => {
        props?.onTimeseriesSelectionChange?.(event.selected);
      }}
      tooltip={{
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
        },
        formatter: formatTooltip,
      }}
      xAxis={{
        animation: false,
        axisLabel: {
          padding: [0, 10, 0, 10],
          width: 60,
        },
        splitNumber: 0,
      }}
      yAxis={{
        animation: false,
        axisLabel: {
          formatter(value: number) {
            return formatYAxisValue(value, yAxisFieldType, yAxisUnit ?? undefined);
          },
        },
        axisPointer: {
          type: 'line',
          snap: false,
          lineStyle: {
            type: 'solid',
            width: 0.5,
          },
          label: {
            show: false,
          },
        },
      }}
      {...chartZoomProps}
      isGroupedByDate
      useMultilineDate
      start={start ? new Date(start) : undefined}
      end={end ? new Date(end) : undefined}
      period={period}
      utc={utc ?? undefined}
    />
  );
}

const SeriesConstructors: Record<VisualizationType, SeriesConstructor> = {
  area: AreaChartWidgetSeries,
  line: LineChartWidgetSeries,
  bar: BarChartWidgetSeries,
};
