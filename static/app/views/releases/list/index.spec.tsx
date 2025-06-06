import {LocationFixture} from 'sentry-fixture/locationFixture';
import {OrganizationFixture} from 'sentry-fixture/organization';
import {ProjectFixture} from 'sentry-fixture/project';
import {ReleaseFixture} from 'sentry-fixture/release';

import {initializeOrg} from 'sentry-test/initializeOrg';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from 'sentry-test/reactTestingLibrary';

import {ReleasesSortOption} from 'sentry/constants/releases';
import ProjectsStore from 'sentry/stores/projectsStore';
import ReleasesList from 'sentry/views/releases/list/';
import {ReleasesDisplayOption} from 'sentry/views/releases/list/releasesDisplayOptions';
import {ReleasesStatusOption} from 'sentry/views/releases/list/releasesStatusOptions';

describe('ReleasesList', () => {
  const {organization, projects, router, routerProps} = initializeOrg();
  const semverVersionInfo = {
    buildHash: null,
    description: '1.2.3',
    package: 'package',
    version: {
      raw: '1.2.3',
      major: 1,
      minor: 2,
      patch: 3,
      buildCode: null,
      components: 3,
    },
  };

  const props = {
    ...routerProps,
    router,
    organization,
    selection: {
      projects: [],
      environments: [],
      datetime: {
        period: '14d',
        start: null,
        end: null,
        utc: null,
      },
    },
    params: {orgId: organization.slug},
    location: {
      ...routerProps.location,
      query: {
        query: 'derp',
        sort: ReleasesSortOption.SESSIONS,
        healthStatsPeriod: '24h',
        somethingBad: 'XXX',
        status: ReleasesStatusOption.ACTIVE,
      },
    },
  };
  let endpointMock: jest.Mock;
  let sessionApiMock: jest.Mock;

  beforeEach(() => {
    act(() => ProjectsStore.loadInitialData(projects));
    endpointMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/releases/',
      body: [
        ReleaseFixture({
          version: '1.0.0',
          versionInfo: {
            ...semverVersionInfo,
            version: {...semverVersionInfo.version, raw: '1.0.0'},
          },
        }),
        ReleaseFixture({
          version: '1.0.1',
          versionInfo: {
            ...semverVersionInfo,
            version: {...semverVersionInfo.version, raw: '1.0.1'},
          },
        }),
        {
          ...ReleaseFixture({version: 'af4f231ec9a8'}),
          projects: [
            {
              id: 4383604,
              name: 'Sentry-IOS-Shop',
              slug: 'sentry-ios-shop',
              hasHealthData: false,
            },
          ],
        },
      ],
    });

    sessionApiMock = MockApiClient.addMockResponse({
      url: `/organizations/org-slug/sessions/`,
      body: null,
    });

    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/projects/',
      body: [],
    });
  });

  afterEach(() => {
    act(() => ProjectsStore.reset());
    MockApiClient.clearMockResponses();
  });

  it('renders list', async () => {
    render(<ReleasesList {...props} />, {
      router,
      organization,
    });
    const items = await screen.findAllByTestId('release-panel');

    expect(items).toHaveLength(3);

    expect(within(items.at(0)!).getByText('1.0.0')).toBeInTheDocument();
    expect(within(items.at(0)!).getByText('Adoption')).toBeInTheDocument();
    expect(within(items.at(1)!).getByText('1.0.1')).toBeInTheDocument();
    // Crash free rate loads separately
    expect(await within(items.at(1)!).findByText('0%')).toBeInTheDocument();
    expect(within(items.at(2)!).getByText('af4f231ec9a8')).toBeInTheDocument();
    expect(within(items.at(2)!).getByText('Project Name')).toBeInTheDocument();
  });

  it('displays the right empty state', async () => {
    let location: ReturnType<typeof LocationFixture>;

    const project = ProjectFixture({
      id: '3',
      slug: 'test-slug',
      name: 'test-name',
      features: ['releases'],
    });
    const projectWithouReleases = ProjectFixture({
      id: '4',
      slug: 'test-slug-2',
      name: 'test-name-2',
      features: [],
    });
    const org = OrganizationFixture();
    ProjectsStore.loadInitialData([project, projectWithouReleases]);
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/releases/',
      body: [],
    });
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/sentry-apps/',
      body: [],
    });
    // does not have releases set up and no releases
    location = LocationFixture({...routerProps.location, query: {}});
    const {rerender} = render(
      <ReleasesList
        {...props}
        location={location}
        selection={{...props.selection, projects: [4]}}
      />,
      {
        router,
        organization,
      }
    );

    expect(await screen.findByText('Set up Releases')).toBeInTheDocument();
    expect(screen.queryByTestId('release-panel')).not.toBeInTheDocument();

    // has releases set up and no releases
    location = LocationFixture({query: {query: 'abc'}});
    rerender(
      <ReleasesList
        {...props}
        organization={org}
        location={location}
        selection={{...props.selection, projects: [3]}}
      />
    );
    expect(
      await screen.findByText("There are no releases that match: 'abc'.")
    ).toBeInTheDocument();

    location = LocationFixture({
      query: {sort: ReleasesSortOption.SESSIONS, statsPeriod: '7d'},
    });
    rerender(
      <ReleasesList
        {...props}
        organization={org}
        location={location}
        selection={{...props.selection, projects: [3]}}
      />
    );
    expect(
      await screen.findByText('There are no releases with data in the last 7 days.')
    ).toBeInTheDocument();

    location = LocationFixture({
      query: {sort: ReleasesSortOption.USERS_24_HOURS, statsPeriod: '7d'},
    });
    rerender(
      <ReleasesList
        {...props}
        organization={org}
        location={location}
        selection={{...props.selection, projects: [3]}}
      />
    );
    expect(
      await screen.findByText(
        'There are no releases with active user data (users in the last 24 hours).'
      )
    ).toBeInTheDocument();

    location = LocationFixture({
      query: {sort: ReleasesSortOption.SESSIONS_24_HOURS, statsPeriod: '7d'},
    });
    rerender(
      <ReleasesList
        {...props}
        organization={org}
        location={location}
        selection={{...props.selection, projects: [3]}}
      />
    );
    expect(
      await screen.findByText(
        'There are no releases with active session data (sessions in the last 24 hours).'
      )
    ).toBeInTheDocument();

    location = LocationFixture({query: {sort: ReleasesSortOption.BUILD}});
    rerender(
      <ReleasesList
        {...props}
        organization={org}
        location={location}
        selection={{...props.selection, projects: [3]}}
      />
    );
    expect(
      await screen.findByText('There are no releases with semantic versioning.')
    ).toBeInTheDocument();
  });

  it('displays request errors', async () => {
    const errorMessage = 'dumpster fire';
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/releases/',
      body: {
        detail: errorMessage,
      },
      statusCode: 400,
    });

    render(<ReleasesList {...props} selection={{...props.selection, projects: [3]}} />, {
      router,
      organization,
    });

    expect(await screen.findByText(errorMessage)).toBeInTheDocument();

    // we want release header to be visible despite the error message
    expect(
      await screen.findByRole('combobox', {
        name: 'Add a search term',
      })
    ).toBeInTheDocument();
  });

  it('searches for a release', async () => {
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/recent-searches/',
      method: 'POST',
      body: [],
    });

    render(<ReleasesList {...props} />, {
      router,
      organization,
    });

    const input = await screen.findByDisplayValue('derp');
    expect(input).toBeInTheDocument();

    expect(endpointMock).toHaveBeenCalledWith(
      '/organizations/org-slug/releases/',
      expect.objectContaining({
        query: expect.objectContaining({query: 'derp'}),
      })
    );

    await userEvent.clear(input);
    await userEvent.type(input, 'a{enter}');

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({query: 'a'}),
      })
    );
  });

  it('searches for a release with new searchbar (search-query-builder-releases)', async () => {
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/recent-searches/',
      method: 'POST',
      body: [],
    });
    render(<ReleasesList {...props} />, {
      router,
      organization: {...organization, features: ['search-query-builder-releases']},
    });
    const input = await screen.findByDisplayValue('derp');
    expect(input).toBeInTheDocument();

    expect(endpointMock).toHaveBeenCalledWith(
      '/organizations/org-slug/releases/',
      expect.objectContaining({
        query: expect.objectContaining({query: 'derp'}),
      })
    );

    await userEvent.clear(input);
    await userEvent.type(input, 'a{enter}');

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({query: 'a'}),
      })
    );
  });

  it('sorts releases', async () => {
    render(<ReleasesList {...props} />, {
      router,
      organization,
    });

    await waitFor(() =>
      expect(endpointMock).toHaveBeenCalledWith(
        '/organizations/org-slug/releases/',
        expect.objectContaining({
          query: expect.objectContaining({
            sort: ReleasesSortOption.SESSIONS,
          }),
        })
      )
    );

    await userEvent.click(screen.getByText('Sort By'));

    const dateCreatedOption = screen.getByText('Date Created');
    expect(dateCreatedOption).toBeInTheDocument();

    await userEvent.click(dateCreatedOption);

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          sort: ReleasesSortOption.DATE,
        }),
      })
    );
  });

  it('disables adoption sort when more than one environment is selected', async () => {
    const adoptionProps = {
      ...props,
      organization,
    };
    render(
      <ReleasesList
        {...adoptionProps}
        location={{...routerProps.location, query: {sort: ReleasesSortOption.ADOPTION}}}
        selection={{...props.selection, environments: ['a', 'b']}}
      />,
      {
        router,
        organization,
      }
    );
    const sortDropdown = await screen.findByText('Sort By');

    expect(sortDropdown.parentElement).toHaveTextContent('Sort ByDate Created');
  });

  it('display the right Crash Free column', async () => {
    render(<ReleasesList {...props} />, {
      router,
      organization,
    });

    // Find and click on the display menu's trigger button
    const statusTriggerButton = screen.getByRole('button', {
      name: 'Display Sessions',
    });
    expect(statusTriggerButton).toBeInTheDocument();
    await userEvent.click(statusTriggerButton);

    // Expect to have 2 options in the status dropdown
    const crashFreeSessionsOption = screen.getAllByText('Sessions')[1];
    const crashFreeUsersOption = screen.getByText('Users');
    expect(crashFreeSessionsOption).toBeInTheDocument();
    expect(crashFreeUsersOption).toBeInTheDocument();

    await userEvent.click(crashFreeUsersOption);

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          display: ReleasesDisplayOption.USERS,
        }),
      })
    );
  });

  it('displays archived releases', async () => {
    render(
      <ReleasesList
        {...props}
        location={{
          ...routerProps.location,
          query: {status: ReleasesStatusOption.ARCHIVED},
        }}
      />,
      {
        router,
        organization,
      }
    );

    await waitFor(() =>
      expect(endpointMock).toHaveBeenLastCalledWith(
        '/organizations/org-slug/releases/',
        expect.objectContaining({
          query: expect.objectContaining({status: ReleasesStatusOption.ARCHIVED}),
        })
      )
    );

    expect(
      await screen.findByText('These releases have been archived.')
    ).toBeInTheDocument();

    // Find and click on the status menu's trigger button
    const statusTriggerButton = screen.getByRole('button', {
      name: 'Status Archived',
    });
    expect(statusTriggerButton).toBeInTheDocument();
    await userEvent.click(statusTriggerButton);

    // Expect to have 2 options in the status dropdown
    const statusActiveOption = screen.getByRole('option', {name: 'Active'});
    let statusArchivedOption = screen.getByRole('option', {name: 'Archived'});
    expect(statusActiveOption).toBeInTheDocument();
    expect(statusArchivedOption).toBeInTheDocument();

    await userEvent.click(statusActiveOption);
    expect(router.push).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          status: ReleasesStatusOption.ACTIVE,
        }),
      })
    );

    await userEvent.click(statusTriggerButton);
    statusArchivedOption = screen.getByRole('option', {name: 'Archived'});
    await userEvent.click(statusArchivedOption);
    expect(router.push).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          status: ReleasesStatusOption.ARCHIVED,
        }),
      })
    );
  });

  it('calls api with only explicitly permitted query params', async () => {
    render(<ReleasesList {...props} />, {
      router,
      organization,
    });

    await waitFor(() => {
      expect(endpointMock).toHaveBeenCalledWith(
        '/organizations/org-slug/releases/',
        expect.objectContaining({
          query: expect.not.objectContaining({
            somethingBad: 'XXX',
          }),
        })
      );
    });
  });

  it('calls session api for health data', async () => {
    render(<ReleasesList {...props} />, {
      router,
      organization,
    });

    await waitFor(() => expect(sessionApiMock).toHaveBeenCalledTimes(3));

    expect(sessionApiMock).toHaveBeenCalledWith(
      '/organizations/org-slug/sessions/',
      expect.objectContaining({
        query: expect.objectContaining({
          field: ['sum(session)'],
          groupBy: ['project', 'release', 'session.status'],
          interval: '1d',
          query: 'release:1.0.0 OR release:1.0.1 OR release:af4f231ec9a8',
          statsPeriod: '14d',
        }),
      })
    );

    expect(sessionApiMock).toHaveBeenCalledWith(
      '/organizations/org-slug/sessions/',
      expect.objectContaining({
        query: expect.objectContaining({
          field: ['sum(session)'],
          groupBy: ['project'],
          interval: '1h',
          query: undefined,
          statsPeriod: '24h',
        }),
      })
    );

    expect(sessionApiMock).toHaveBeenCalledWith(
      '/organizations/org-slug/sessions/',
      expect.objectContaining({
        query: expect.objectContaining({
          field: ['sum(session)'],
          groupBy: ['project', 'release'],
          interval: '1h',
          query: 'release:1.0.0 OR release:1.0.1 OR release:af4f231ec9a8',
          statsPeriod: '24h',
        }),
      })
    );
  });

  it('shows health rows only for selected projects in global header', async () => {
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/releases/',
      body: [
        {
          ...ReleaseFixture({version: '2.0.0'}),
          projects: [
            {
              id: 1,
              name: 'Test',
              slug: 'test',
            },
            {
              id: 2,
              name: 'Test2',
              slug: 'test2',
            },
            {
              id: 3,
              name: 'Test3',
              slug: 'test3',
            },
          ],
        },
      ],
    });
    render(<ReleasesList {...props} selection={{...props.selection, projects: [2]}} />, {
      router,
      organization,
    });
    const hiddenProjectsMessage = await screen.findByTestId('hidden-projects');
    expect(hiddenProjectsMessage).toHaveTextContent('2 hidden projects');

    expect(screen.getAllByTestId('release-card-project-row')).toHaveLength(1);

    expect(screen.getByTestId('badge-display-name')).toHaveTextContent('test2');
  });

  it('does not hide health rows when "All Projects" are selected in global header', async () => {
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/releases/',
      body: [ReleaseFixture({version: '2.0.0'})],
    });
    render(<ReleasesList {...props} selection={{...props.selection, projects: [-1]}} />, {
      router,
      organization,
    });

    expect(await screen.findByTestId('release-card-project-row')).toBeInTheDocument();
    expect(screen.queryByTestId('hidden-projects')).not.toBeInTheDocument();
  });

  it('autocompletes semver search tag', async () => {
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/tags/release.version/values/',
      body: [
        {
          count: null,
          firstSeen: null,
          key: 'release.version',
          lastSeen: null,
          name: 'sentry@0.5.3',
          value: 'sentry@0.5.3',
        },
      ],
    });
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/recent-searches/',
      method: 'POST',
    });
    render(<ReleasesList {...props} location={{...props.location, query: {}}} />, {
      router,
      organization,
    });
    const smartSearchBar = await screen.findByRole('combobox', {
      name: 'Add a search term',
    });
    await userEvent.click(smartSearchBar);
    await userEvent.clear(smartSearchBar);
    expect(await screen.findByRole('option', {name: 'release'})).toBeInTheDocument();

    await userEvent.clear(smartSearchBar);
    await userEvent.click(screen.getByRole('option', {name: 'release.version'}));

    expect(await screen.findByText('sentry@0.5.3')).toBeInTheDocument();
  });
});
