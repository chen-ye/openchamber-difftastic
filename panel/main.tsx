import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { connectHost, type HostReadyContext } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { DiffView } from '../src/DiffView';
import { PANEL_CSS } from './styles';

const ensurePanelStyles = () => {
  if (document.getElementById('oc-difftastic-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'oc-difftastic-panel-styles';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
};

const host = connectHost();

const App: React.FC<{ initialReady: HostReadyContext }> = ({ initialReady }) => {
  const [ready, setReady] = useState<HostReadyContext>(initialReady);
  const [directory, setDirectory] = useState<string | null>(initialReady.directory);
  const [lifecycleTick, setLifecycleTick] = useState(0);

  useEffect(() => {
    const unsubReady = host.onReady((ctx) => {
      applyHostReady(ctx, document.documentElement);
      setReady(ctx);
      setDirectory(ctx.directory);
    });
    const unsubDir = host.onDirectory((dir) => {
      setDirectory(dir);
    });
    const unsubLifecycle = host.onSessionLifecycle((evt) => {
      if (evt.phase === 'completed') {
        setLifecycleTick((t) => t + 1);
      }
    });
    return () => {
      unsubReady();
      unsubDir();
      unsubLifecycle();
    };
  }, []);

  return (
    <DiffView
      host={host}
      ready={ready}
      directory={directory}
      lifecycleTick={lifecycleTick}
    />
  );
};

ensurePanelStyles();

let mounted = false;
host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  if (mounted) return;
  mounted = true;
  const rootEl = document.getElementById('root');
  if (!rootEl) return;
  createRoot(rootEl).render(<App initialReady={ctx} />);
});
