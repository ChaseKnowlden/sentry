import styled from '@emotion/styled';

import Panel from 'sentry/components/panels/panel';
import {space} from 'sentry/styles/space';
import textStyles from 'sentry/styles/text';

type Props = {
  children: React.ReactNode;
  button?: React.JSX.Element;
  subtitle?: string;
  title?: string;
};

export default function MiniChartPanel({title, children, button, subtitle}: Props) {
  return (
    <Panel>
      <PanelBody>
        {(title || button || subtitle) && (
          <HeaderContainer>
            <Header>
              {title && <ChartLabel>{title}</ChartLabel>}
              {button}
            </Header>
            {subtitle && <Subtitle>{subtitle}</Subtitle>}
          </HeaderContainer>
        )}
        {children}
      </PanelBody>
    </Panel>
  );
}

const ChartLabel = styled('p')`
  /* @TODO(jonasbadalic) This should be a title component and not a p */
  font-size: 1rem;
  font-weight: ${p => p.theme.fontWeightBold};
  line-height: 1.2;
`;

const HeaderContainer = styled('div')`
  padding: 0 ${space(1)} 0 0;
`;

const Header = styled('div')`
  min-height: 24px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const PanelBody = styled('div')`
  padding: ${space(1.5)} ${space(2)};
  ${textStyles};
`;

const Subtitle = styled('span')`
  color: ${p => p.theme.subText};
  font-size: ${p => p.theme.fontSizeSmall};
  display: inline-block;
`;
