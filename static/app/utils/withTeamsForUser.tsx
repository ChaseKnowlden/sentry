import {Component} from 'react';

import type {Client} from 'sentry/api';
import ConfigStore from 'sentry/stores/configStore';
import type {Organization, Team} from 'sentry/types/organization';
import type {Project, TeamWithProjects} from 'sentry/types/project';
import getDisplayName from 'sentry/utils/getDisplayName';
import getProjectsByTeams from 'sentry/utils/getProjectsByTeams';

// We require these props when using this HOC
type DependentProps = {
  api: Client;
  organization: Organization;
};

type InjectedTeamsProps = {
  error: Error | null;
  loadingTeams: boolean;
  teams: TeamWithProjects[];
};

const withTeamsForUser = <P extends InjectedTeamsProps>(
  WrappedComponent: React.ComponentType<P>
) =>
  class extends Component<
    Omit<P, keyof InjectedTeamsProps> & Partial<InjectedTeamsProps> & DependentProps,
    InjectedTeamsProps
  > {
    static displayName = `withUsersTeams(${getDisplayName(WrappedComponent)})`;

    state: InjectedTeamsProps = {
      teams: [],
      loadingTeams: true,
      error: null,
    };

    componentDidMount() {
      this.fetchTeams();
    }

    async fetchTeams() {
      this.setState({
        loadingTeams: true,
      });

      try {
        const teamsWithProjects: TeamWithProjects[] = await this.props.api.requestPromise(
          this.getUsersTeamsEndpoint()
        );
        this.setState({
          teams: teamsWithProjects,
          loadingTeams: false,
        });
      } catch (error) {
        this.setState({
          error,
          loadingTeams: false,
        });
      }
    }

    populateTeamsWithProjects(teams: Team[], projects: Project[]) {
      const {isSuperuser} = ConfigStore.get('user');
      const {projectsByTeam} = getProjectsByTeams(teams, projects, isSuperuser);
      const teamsWithProjects: TeamWithProjects[] = teams.map(team => {
        const teamProjects = projectsByTeam[team.slug] || [];
        return {...team, projects: teamProjects};
      });
      this.setState({
        teams: teamsWithProjects,
        loadingTeams: false,
      });
    }

    getUsersTeamsEndpoint() {
      return `/organizations/${this.props.organization.slug}/user-teams/`;
    }

    render() {
      return <WrappedComponent {...(this.props as P & DependentProps)} {...this.state} />;
    }
  };

export default withTeamsForUser;
