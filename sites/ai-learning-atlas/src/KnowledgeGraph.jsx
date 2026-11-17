import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { stages } from './data/course.js';
import './graph.css';

const chapterIndex = new Map(stages.flatMap((stage) =>
  stage.chapters.map((chapter) => [chapter.id, chapter]),
));
const emptyProgress = new Set();
const positions = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const fitOptions = {
  padding: { top: '16px', right: '18px', bottom: '49px', left: '18px' },
  maxZoom: 1.13,
};
const graphLabels = {
  'controls.ariaLabel': '图谱视图控制',
  'controls.zoomIn.ariaLabel': '放大',
  'controls.zoomOut.ariaLabel': '缩小',
  'controls.fitView.ariaLabel': '恢复全览',
};

function GraphNode({ data }) {
  const classes = [
    'atlas-graph-node',
    data.optional && 'atlas-graph-node--optional',
    data.external && 'atlas-graph-node--external',
    data.active && 'atlas-graph-node--active',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {positions.map((position) => (
        <Handle
          key={`target-${position}`}
          id={`target-${position}`}
          type="target"
          position={position}
          isConnectable={false}
        />
      ))}
      <button
        className="atlas-graph-node-button"
        type="button"
        aria-pressed={data.active}
        aria-label={`${data.number} ${data.fullTitle}${data.optional ? '，选学' : ''}${data.done ? '，已完成' : ''}`}
        onClick={data.select}
        title={data.fullTitle}
      >
        <span className="atlas-graph-node-meta">
          {data.number}
          {data.done && <span className="atlas-graph-done" aria-hidden="true">✓</span>}
          {data.external && <span className="atlas-graph-node-extra">跨阶段</span>}
        </span>
        <span className="atlas-graph-node-title">{data.title}</span>
      </button>
      {positions.map((position) => (
        <Handle
          key={`source-${position}`}
          id={`source-${position}`}
          type="source"
          position={position}
          isConnectable={false}
        />
      ))}
    </div>
  );
}

const nodeTypes = { atlas: GraphNode };

function graphNode(id, position, data) {
  return {
    id: String(id),
    position,
    data,
    type: 'atlas',
    dragHandle: '.atlas-graph-node-meta',
    focusable: false,
  };
}

function makeEdge(source, target, color, dashed = false, subdued = false) {
  let exit = Position.Right;
  let entry = Position.Left;

  if (source.position.y !== target.position.y) {
    const flowsDown = source.position.y < target.position.y;
    exit = flowsDown ? Position.Bottom : Position.Top;
    entry = flowsDown ? Position.Top : Position.Bottom;
  } else if (source.position.x > target.position.x) {
    exit = Position.Left;
    entry = Position.Right;
  }

  return {
    id: `${source.id}-${target.id}`,
    source: source.id,
    target: target.id,
    sourceHandle: `source-${exit}`,
    targetHandle: `target-${entry}`,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
    style: {
      stroke: color,
      strokeWidth: 1.55,
      strokeDasharray: dashed ? '4 4' : undefined,
      opacity: subdued ? 0.4 : 1,
    },
  };
}

function getStageGraph({ compact, selectedStage, onStageSelect, completed }) {
  const columns = compact ? 2 : 5;
  const firstOptional = stages.findIndex((stage) => stage.optional);
  const nodes = stages.map((stage, index) => {
    const row = Math.floor(index / columns);
    const offset = index % columns;
    const column = compact && row % 2 !== 0 ? columns - offset - 1 : offset;
    const number = stage.optional
      ? `阶段 ${firstOptional + 1}.${index - firstOptional + 1}`
      : `阶段 ${index + 1}`;
    return graphNode(stage.id, {
      x: column * (compact ? 168 : 157),
      y: row * (compact ? 91 : 143),
    }, {
      number,
      title: stage.shortTitle ?? stage.title,
      fullTitle: stage.title,
      optional: stage.optional,
      active: stage.id === selectedStage,
      done: stage.chapters.length > 0 && stage.chapters.every((chapter) => completed.has(chapter.id)),
      select: () => onStageSelect(stage.id),
    });
  });
  const edges = nodes.slice(1).map((node, index) =>
    makeEdge(nodes[index], node, node.data.optional ? '#a77c39' : '#8b70cb', node.data.optional),
  );
  return { nodes, edges };
}

function getChapterGraph({ stage, compact, selectedChapter, onChapterSelect, completed }) {
  const localIds = new Set(stage.chapters.map((chapter) => chapter.id));
  const externalIds = new Set(stage.chapters.flatMap((chapter) => chapter.requires ?? [])
    .filter((id) => chapterIndex.has(id) && !localIds.has(id)));
  const external = [...externalIds].sort((first, second) => first - second)
    .map((id) => chapterIndex.get(id));
  const columns = compact ? 2 : 5;
  const columnGap = compact ? 171 : 166;
  const rowGap = compact ? 98 : 102;
  const nodes = [];

  function addRow(chapters, startY, isExternal) {
    chapters.forEach((chapter, index) => {
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, chapters.length - row * columns);
      const offset = (columns - rowCount) / 2;
      nodes.push(graphNode(chapter.id, {
        x: (index % columns + offset) * columnGap,
        y: startY + row * rowGap,
      }, {
        number: `第 ${chapter.id} 章`,
        title: chapter.title,
        fullTitle: chapter.title,
        optional: chapter.optional,
        external: isExternal,
        active: chapter.id === selectedChapter,
        done: completed.has(chapter.id),
        select: () => onChapterSelect(chapter.id),
      }));
    });
  }

  addRow(external, 0, true);
  const chapterY = external.length > 0 ? Math.ceil(external.length / columns) * rowGap + 17 : 0;
  addRow(stage.chapters, chapterY, false);

  const byId = new Map(nodes.map((node) => [Number(node.id), node]));
  const edges = stage.chapters.flatMap((chapter) => (chapter.requires ?? []).flatMap((id) => {
    const source = byId.get(id);
    if (!source) return [];
    const connected = !selectedChapter || selectedChapter === id || selectedChapter === chapter.id;
    return [makeEdge(source, byId.get(chapter.id), '#8b70cb', source.data.external, !connected)];
  }));

  return { nodes, edges };
}

function GraphCanvas({ sourceNodes, edges }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(sourceNodes);

  useEffect(() => {
    setNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]));
      return sourceNodes.map((node) => ({
        ...node,
        position: previous.get(node.id)?.position ?? node.position,
        measured: previous.get(node.id)?.measured,
      }));
    });
  }, [setNodes, sourceNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      fitView
      fitViewOptions={fitOptions}
      minZoom={0.24}
      maxZoom={2.3}
      nodeDragThreshold={5}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      deleteKeyCode={null}
      ariaLabelConfig={graphLabels}
    >
      <Background
        variant={BackgroundVariant.Dots}
        color="#d9d1cf"
        gap={22}
        size={1.1}
      />
      <Controls
        className="atlas-graph-controls"
        fitViewOptions={fitOptions}
        position="bottom-right"
        orientation="horizontal"
        showInteractive={false}
      />
    </ReactFlow>
  );
}

export default function KnowledgeGraph({
  selectedStage = stages[0].id,
  onStageSelect,
  selectedChapter = null,
  onChapterSelect,
  completed = emptyProgress,
}) {
  const viewport = useRef(null);
  const [view, setView] = useState('stages');
  const [compact, setCompact] = useState(false);
  const stage = stages.find((entry) => entry.id === selectedStage) ?? stages[0];
  const chaptersView = view === 'chapters';

  useEffect(() => {
    const element = viewport.current;
    const observer = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < 570);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (chaptersView) {
      return getChapterGraph({ stage, compact, selectedChapter, onChapterSelect, completed });
    }
    return getStageGraph({ compact, selectedStage, onStageSelect, completed });
  }, [chaptersView, stage, compact, selectedChapter, onChapterSelect, completed, selectedStage, onStageSelect]);

  return (
    <div className="atlas-graph">
      <div className="atlas-graph-toolbar">
        <h2>知识图谱</h2>
        <div className="atlas-graph-toolbar-controls">
          {chaptersView && (
            <select
              className="atlas-graph-stage-filter"
              aria-label="选择章节所属阶段"
              value={stage.id}
              onChange={(event) => onStageSelect(event.target.value)}
            >
              {stages.map((entry) => <option key={entry.id} value={entry.id}>{entry.shortTitle}</option>)}
            </select>
          )}
          <div className="atlas-graph-switch" role="group" aria-label="图谱内容">
            <button type="button" aria-pressed={!chaptersView} onClick={() => setView('stages')}>
              阶段路线
            </button>
            <button type="button" aria-pressed={chaptersView} onClick={() => setView('chapters')}>
              章节依赖
            </button>
          </div>
        </div>
      </div>
      <div
        className={`atlas-graph-viewport${compact ? ' atlas-graph-viewport--compact' : ''}`}
        ref={viewport}
        role="region"
        aria-label={chaptersView ? `${stage.title}章节依赖图` : '人工智能学习阶段图'}
      >
        <GraphCanvas
          key={`${view}-${compact}-${chaptersView ? stage.id : 'all'}`}
          sourceNodes={nodes}
          edges={edges}
        />
      </div>
      <div className="atlas-graph-legend">
        <span><i className="atlas-graph-key atlas-graph-key--core" />先学</span>
        <span><i className="atlas-graph-key atlas-graph-key--optional" />{chaptersView ? '选学' : '方向进阶'}</span>
        {chaptersView && <span><i className="atlas-graph-key atlas-graph-key--external" />跨阶段前置</span>}
        <span className="atlas-graph-help">{chaptersView ? '箭头从前置章节指向下一章' : '箭头代表学习顺序'}</span>
      </div>
    </div>
  );
}
