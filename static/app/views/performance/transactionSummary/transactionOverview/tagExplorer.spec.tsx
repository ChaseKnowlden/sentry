import {LocationFixture} from 'sentry-fixture/locationFixture';
import {OrganizationFixture} from 'sentry-fixture/organization';
import {ProjectFixture} from 'sentry-fixture/project';

import {initializeOrg} from 'sentry-test/initializeOrg';
import {render, screen, waitFor} from 'sentry-test/reactTestingLibrary';

import ProjectsStore from 'sentry/stores/projectsStore';
import EventView from 'sentry/utils/discover/eventView';
import {MEPSettingProvider} from 'sentry/utils/performance/contexts/metricsEnhancedSetting';
import {useLocation} from 'sentry/utils/useLocation';
import {OrganizationContext} from 'sentry/views/organizationContext';
import {SpanOperationBreakdownFilter} from 'sentry/views/performance/transactionSummary/filter';
import {TagExplorer} from 'sentry/views/performance/transactionSummary/transactionOverview/tagExplorer';

jest.mock('sentry/utils/useLocation');

const mockUseLocation = jest.mocked(useLocation);

function WrapperComponent(props: React.ComponentProps<typeof TagExplorer>) {
  return (
    <OrganizationContext value={props.organization}>
      <MEPSettingProvider>
        <TagExplorer {...props} />
      </MEPSettingProvider>
    </OrganizationContext>
  );
}

function initialize(query: Record<string, string>, additionalFeatures = []) {
  const features = ['transaction-event', 'performance-view', ...additionalFeatures];
  const organization = OrganizationFixture({
    features,
  });
  const initialOrgData = {
    organization,
    router: {
      location: {
        query: {...query},
      },
    },
  };
  const initialData = initializeOrg(initialOrgData);
  ProjectsStore.loadInitialData(initialData.projects);
  const eventView = EventView.fromLocation(initialData.router.location);

  const spanOperationBreakdownFilter = SpanOperationBreakdownFilter.NONE;
  const transactionName = 'example-transaction';

  return {
    ...initialData,
    spanOperationBreakdownFilter,
    transactionName,
    location: initialData.router.location,
    eventView,
  };
}

describe('WrapperComponent', function () {
  const facetUrl = '/organizations/org-slug/events-facets-performance/';
  let facetApiMock: jest.Mock;
  beforeEach(function () {
    mockUseLocation.mockReturnValue(
      LocationFixture({pathname: '/organizations/org-slug/insights/summary'})
    );
    facetApiMock = MockApiClient.addMockResponse({
      url: facetUrl,
      body: {
        data: [
          {
            tags_key: 'client_os',
            tags_value: 'Mac OS X 10.15.7',
            sumdelta: 647.4285714285729,
            count: 44,
            frequency: 1.6285714285714286,
            comparison: 1.0517781861420388,
            aggregate: 352.72727272727272,
          },
          {
            tags_key: 'browser.name',
            tags_value: 'Chrome',
            sumdelta: 547.4285714285729,
            count: 44,
            frequency: 0.6285714285714286,
            comparison: 1.0517781861420388,
            aggregate: 252.72727272727272,
          },
        ],
        meta: {
          tags_key: 'string',
          tags_value: 'string',
          sumdelta: 'duration',
          count: 'integer',
          frequency: 'number',
          comparison: 'number',
          aggregate: 'number',
        },
      },
    });
  });

  afterEach(function () {
    MockApiClient.clearMockResponses();
    ProjectsStore.reset();
  });

  it('renders basic UI elements', async function () {
    const projects = [ProjectFixture()];
    const {
      organization,
      location,
      eventView,
      spanOperationBreakdownFilter,
      transactionName,
    } = initialize({});

    render(
      <WrapperComponent
        location={location}
        organization={organization}
        eventView={eventView}
        projects={projects}
        transactionName={transactionName}
        currentFilter={spanOperationBreakdownFilter}
      />
    );

    expect(
      await screen.findByRole('heading', {name: 'Suspect Tags'})
    ).toBeInTheDocument();
    expect(screen.getByTestId('grid-editable')).toBeInTheDocument();
  });

  it('Tag explorer uses LCP if projects are frontend', async function () {
    const projects = [ProjectFixture({id: '123', platform: 'javascript-react'})];
    const {
      organization,
      location,
      eventView,
      spanOperationBreakdownFilter,
      transactionName,
    } = initialize({
      project: '123',
    });

    render(
      <WrapperComponent
        location={location}
        organization={organization}
        eventView={eventView}
        projects={projects}
        transactionName={transactionName}
        currentFilter={spanOperationBreakdownFilter}
      />
    );

    expect((await screen.findAllByTestId('grid-head-cell'))[2]).toHaveTextContent(
      'Avg LCP'
    );

    expect(facetApiMock).toHaveBeenCalledWith(
      facetUrl,
      expect.objectContaining({
        query: expect.objectContaining({
          aggregateColumn: 'measurements.lcp',
        }),
      })
    );
  });

  it('Tag explorer view all tags button links to tags page', async function () {
    const projects = [ProjectFixture({id: '123', platform: 'javascript-react'})];
    const {
      organization,
      location,
      eventView,
      spanOperationBreakdownFilter,
      transactionName,
      router,
    } = initialize(
      {
        project: '123',
      },
      []
    );

    render(
      <WrapperComponent
        location={location}
        organization={organization}
        eventView={eventView}
        projects={projects}
        transactionName={transactionName}
        currentFilter={spanOperationBreakdownFilter}
      />,
      {router}
    );

    const button = await screen.findByTestId('tags-explorer-open-tags');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute(
      'href',
      '/organizations/org-slug/insights/summary/tags/?project=123&transaction=example-transaction'
    );
  });

  it('Tag explorer uses the operation breakdown as a column', async function () {
    const projects = [ProjectFixture({platform: 'javascript-react'})];
    const {organization, location, eventView, transactionName} = initialize({});

    render(
      <WrapperComponent
        location={location}
        organization={organization}
        eventView={eventView}
        projects={projects}
        transactionName={transactionName}
        currentFilter={SpanOperationBreakdownFilter.HTTP}
      />
    );

    expect((await screen.findAllByTestId('grid-head-cell'))[2]).toHaveTextContent(
      'Avg Span Duration'
    );

    expect(facetApiMock).toHaveBeenCalledWith(
      facetUrl,
      expect.objectContaining({
        query: expect.objectContaining({
          aggregateColumn: 'spans.http',
        }),
      })
    );
  });

  it('renders the table headers in the correct order', async function () {
    const projects = [ProjectFixture()];
    const {
      organization,
      location,
      eventView,
      spanOperationBreakdownFilter,
      transactionName,
      router,
    } = initialize({});

    render(
      <WrapperComponent
        location={location}
        organization={organization}
        eventView={eventView}
        projects={projects}
        transactionName={transactionName}
        currentFilter={spanOperationBreakdownFilter}
      />,
      {router}
    );

    await waitFor(() => expect(facetApiMock).toHaveBeenCalled());
    const headers = screen.getAllByTestId('grid-head-cell');
    expect(headers).toHaveLength(6);
    const [_, ___, avgDuration, frequency, comparedToAvg, totalTimeLost] = headers;
    expect(avgDuration).toHaveTextContent('Avg Duration');
    expect(frequency).toHaveTextContent('Frequency');
    expect(comparedToAvg).toHaveTextContent('Compared To Avg');
    expect(totalTimeLost).toHaveTextContent('Total Time Lost');
  });
});
