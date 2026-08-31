import { fetchWithStage, type FetchWithStageRequest } from './api';
import type { ManimArtifact, Source, ToolActivity } from '../types';

export interface StreamQASnapshot {
  answer: string;
  thinking: string;
  toolActivities: ToolActivity[];
  artifacts: ManimArtifact[];
  sources: Source[];
}

interface StreamQAHandlers {
  onStage?: (stage: string, text: string) => void;
  onThinkingChange?: (active: boolean) => void;
  onUpdate?: (snapshot: StreamQASnapshot) => void;
}

function upsertToolActivity(items: ToolActivity[], activity: ToolActivity): ToolActivity[] {
  return items.some(item => item.id === activity.id)
    ? items.map(item => item.id === activity.id ? activity : item)
    : [...items, activity];
}

/** Shared streaming transport used by the page panel and capture bubble. */
export async function streamQA(
  request: FetchWithStageRequest,
  handlers: StreamQAHandlers = {},
) {
  const snapshot: StreamQASnapshot = { answer: '', thinking: '', toolActivities: [], artifacts: [], sources: [] };
  const publish = () => handlers.onUpdate?.({
    answer: snapshot.answer,
    thinking: snapshot.thinking,
    toolActivities: [...snapshot.toolActivities],
    artifacts: [...snapshot.artifacts],
    sources: [...snapshot.sources],
  });

  const result = await fetchWithStage({
    request,
    callbacks: {
      onStage: (stage, text) => handlers.onStage?.(stage, text),
      onThinking: text => {
        snapshot.thinking += text;
        publish();
      },
      onIsThinkingChange: value => handlers.onThinkingChange?.(value),
      onContent: text => {
        snapshot.answer += text;
        publish();
      },
      onToolActivity: activity => {
        snapshot.toolActivities = upsertToolActivity(snapshot.toolActivities, activity);
        publish();
      },
      onArtifact: artifact => {
        snapshot.artifacts = snapshot.artifacts.some(item => item.id === artifact.id)
          ? snapshot.artifacts.map(item => item.id === artifact.id ? artifact : item)
          : [...snapshot.artifacts, artifact];
        publish();
      },
    },
  });

  snapshot.answer ||= result.answer;
  snapshot.thinking ||= result.thinking;
  if (!snapshot.toolActivities.length) snapshot.toolActivities = result.toolActivities;
  if (!snapshot.artifacts.length) snapshot.artifacts = result.artifacts;
  snapshot.sources = result.sources;
  publish();
  return { ...result, ...snapshot };
}
