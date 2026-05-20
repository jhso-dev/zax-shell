import React from 'react';
import { render, Box, Text } from 'ink';
import { DashboardPane } from './ui/DashboardPane.js';
import { EpicsPane } from './ui/EpicsPane.js';
import { ArtifactsPane } from './ui/ArtifactsPane.js';
import { loadConfig } from './config/index.js';

type PaneName = 'dashboard' | 'epics' | 'artifacts';

const parseArgs = (): { pane: PaneName } => {
  const args = process.argv.slice(2);
  let pane: PaneName = 'epics';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--pane' && args[i + 1]) {
      const v = args[i + 1] as string;
      if (v === 'dashboard' || v === 'epics' || v === 'artifacts') pane = v;
      i++;
    } else if (a?.startsWith('--pane=')) {
      const v = a.slice('--pane='.length);
      if (v === 'dashboard' || v === 'epics' || v === 'artifacts') pane = v as PaneName;
    }
  }
  return { pane };
};

const { pane } = parseArgs();
const cfg = loadConfig();

const App: React.FC = () => {
  switch (pane) {
    case 'dashboard': return <DashboardPane productHubPath={cfg.productHubPath} />;
    case 'epics':     return <EpicsPane productHubPath={cfg.productHubPath} />;
    case 'artifacts': return <ArtifactsPane productHubPath={cfg.productHubPath} />;
    default:
      return (
        <Box>
          <Text color="red">Unknown pane: {String(pane)}</Text>
        </Box>
      );
  }
};

render(<App />);
