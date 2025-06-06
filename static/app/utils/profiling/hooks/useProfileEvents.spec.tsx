import type {ReactNode} from 'react';

import {initializeOrg} from 'sentry-test/initializeOrg';
import {makeTestQueryClient} from 'sentry-test/queryClient';
import {renderHook, waitFor} from 'sentry-test/reactTestingLibrary';

import type {EventsResults} from 'sentry/utils/profiling/hooks/types';
import {useProfileEvents} from 'sentry/utils/profiling/hooks/useProfileEvents';
import {formatSort} from 'sentry/utils/profiling/hooks/utils';
import {QueryClientProvider} from 'sentry/utils/queryClient';
import {OrganizationContext} from 'sentry/views/organizationContext';

const {organization} = initializeOrg();
function TestContext({children}: {children?: ReactNode}) {
  return (
    <QueryClientProvider client={makeTestQueryClient()}>
      <OrganizationContext value={organization}>{children}</OrganizationContext>
    </QueryClientProvider>
  );
}

describe('useProfileEvents', function () {
  afterEach(function () {
    MockApiClient.clearMockResponses();
  });

  it('handles querying the api using discover', async function () {
    const {organization: organizationUsingTransactions} = initializeOrg();

    function TestContextUsingTransactions({children}: {children?: ReactNode}) {
      return (
        <QueryClientProvider client={makeTestQueryClient()}>
          <OrganizationContext value={organizationUsingTransactions}>
            {children}
          </OrganizationContext>
        </QueryClientProvider>
      );
    }

    const fields = ['count()'];

    const body: EventsResults<(typeof fields)[number]> = {
      data: [],
      meta: {fields: {}, units: {}},
    };

    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/events/`,
      body,
      match: [
        MockApiClient.matchQuery({
          dataset: 'discover',
          query: '(has:profile.id OR (has:profiler.id has:thread.id)) (transaction:foo)',
        }),
      ],
    });

    const {result} = renderHook(useProfileEvents, {
      wrapper: TestContextUsingTransactions,
      initialProps: {
        fields,
        query: 'transaction:foo',
        sort: {key: 'count()', order: 'desc' as const},
        referrer: '',
      },
    });

    await waitFor(() => result.current.isSuccess);
    expect(result.current.data).toEqual(body);
  });

  it('handles api errors', async function () {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/events/`,
      status: 400,
      statusCode: 400,
      match: [MockApiClient.matchQuery({dataset: 'discover'})],
    });

    const {result} = renderHook(useProfileEvents, {
      wrapper: TestContext,
      initialProps: {
        fields: ['count()'],
        sort: {key: 'count()', order: 'desc' as const},
        referrer: '',
      },
    });

    await waitFor(() => result.current.isError);
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});

describe('formatSort', function () {
  it('uses the desc fallback', function () {
    const sort = formatSort(undefined, ['count()'], {
      key: 'count()',
      order: 'desc' as const,
    });
    expect(sort).toEqual({
      key: 'count()',
      order: 'desc',
    });
  });

  it('uses the asc fallback', function () {
    const sort = formatSort(undefined, ['count()'], {
      key: 'count()',
      order: 'asc' as const,
    });
    expect(sort).toEqual({
      key: 'count()',
      order: 'asc',
    });
  });

  it('uses the desc value', function () {
    const sort = formatSort('-p95()', ['p95()', 'count()'], {
      key: 'count()',
      order: 'asc' as const,
    });
    expect(sort).toEqual({
      key: 'p95()',
      order: 'desc',
    });
  });

  it('uses the asc value', function () {
    const sort = formatSort('p95()', ['p95()', 'count()'], {
      key: 'count()',
      order: 'desc' as const,
    });
    expect(sort).toEqual({
      key: 'p95()',
      order: 'asc',
    });
  });
});
