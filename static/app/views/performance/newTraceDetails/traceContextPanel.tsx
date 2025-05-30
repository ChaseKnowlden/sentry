import {useCallback} from 'react';
import styled from '@emotion/styled';

import Feature from 'sentry/components/acl/feature';
import EventTagsTree from 'sentry/components/events/eventTags/eventTagsTree';
import {t} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import type {EventTransaction} from 'sentry/types/event';
import type {UseApiQueryResult} from 'sentry/utils/queryClient';
import type RequestError from 'sentry/utils/requestError/requestError';
import useOrganization from 'sentry/utils/useOrganization';
import type {SectionKey} from 'sentry/views/issueDetails/streamline/context';
import {FoldSection} from 'sentry/views/issueDetails/streamline/foldSection';
import {TraceContextProfiles} from 'sentry/views/performance/newTraceDetails/traceContextProfiles';
import {TraceContextVitals} from 'sentry/views/performance/newTraceDetails/traceContextVitals';
import {TraceContextSectionKeys} from 'sentry/views/performance/newTraceDetails/traceHeader/scrollToSectionLinks';
import {TraceLinkNavigationButton} from 'sentry/views/performance/newTraceDetails/traceLinksNavigation/traceLinkNavigationButton';
import type {TraceTree} from 'sentry/views/performance/newTraceDetails/traceModels/traceTree';
import type {TraceTreeNode} from 'sentry/views/performance/newTraceDetails/traceModels/traceTreeNode';
import {TraceViewLogsSection} from 'sentry/views/performance/newTraceDetails/traceOurlogs';

type Props = {
  onScrollToNode: (node: TraceTreeNode<TraceTree.NodeValue>) => void;
  rootEvent: UseApiQueryResult<EventTransaction, RequestError>;
  tree: TraceTree;
};

export function TraceContextPanel({tree, rootEvent, onScrollToNode}: Props) {
  const renderTags = useCallback(() => {
    if (!rootEvent.data) {
      return null;
    }

    return (
      <EventTagsTree
        event={rootEvent.data}
        meta={rootEvent.data._meta}
        projectSlug={rootEvent.data.projectSlug ?? ''}
        tags={rootEvent.data.tags ?? []}
      />
    );
  }, [rootEvent.data]);

  const organization = useOrganization();
  const showLinkedTraces = organization?.features.includes('trace-view-linked-traces');

  return (
    <Container>
      {showLinkedTraces && (
        <TraceLinksNavigationContainer>
          <TraceLinkNavigationButton
            direction={'previous'}
            isLoading={rootEvent.isLoading}
            traceContext={rootEvent.data?.contexts.trace}
            currentTraceTimestamps={{
              start: rootEvent.data?.startTimestamp,
              end: rootEvent.data?.endTimestamp,
            }}
          />
          <TraceLinkNavigationButton
            direction={'next'}
            isLoading={rootEvent.isLoading}
            projectID={rootEvent.data?.projectID ?? ''}
            traceContext={rootEvent.data?.contexts.trace}
            currentTraceTimestamps={{
              start: rootEvent.data?.startTimestamp,
              end: rootEvent.data?.endTimestamp,
            }}
          />
        </TraceLinksNavigationContainer>
      )}

      <VitalMetersContainer id={TraceContextSectionKeys.WEB_VITALS}>
        <TraceContextVitals tree={tree} />
      </VitalMetersContainer>
      <ContextRow>
        <FoldSection
          sectionKey={TraceContextSectionKeys.TAGS as string as SectionKey}
          title={t('Tags')}
        >
          {renderTags()}
        </FoldSection>
      </ContextRow>
      <ContextRow>
        <TraceContextProfiles tree={tree} onScrollToNode={onScrollToNode} />
      </ContextRow>
      <Feature features={['ourlogs-enabled']}>
        <ContextRow>
          <TraceViewLogsSection />
        </ContextRow>
      </Feature>
    </Container>
  );
}

const Container = styled('div')`
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: ${space(1)};
`;

const VitalMetersContainer = styled('div')`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: ${space(1)};
  width: 100%;
`;

const ContextRow = styled('div')`
  background-color: ${p => p.theme.background};
  width: 100%;
  border: 1px solid ${p => p.theme.border};
  border-radius: ${p => p.theme.borderRadius};
  padding: ${space(1)};
`;

const TraceLinksNavigationContainer = styled('div')`
  display: flex;
  justify-content: space-between;
  flex-direction: row;
  margin: ${space(1)} 0;
`;
