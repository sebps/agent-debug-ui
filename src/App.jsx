import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ReactFlow, Background, MarkerType, Controls, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import dagre from 'dagre';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '@xyflow/react/dist/style.css';
import { Terminal, Eye, Code, User, GripVertical } from 'lucide-react';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;

// Internal component to access useReactFlow hook
function FlowInner({ nodes, edges, onNodeClick, onPaneClick }) {
  const { fitView } = useReactFlow();
  
  // We'll call this whenever the layout changes
  useEffect(() => {
    fitView({ duration: 200 });
  }, [nodes, fitView]);

  return (
    <ReactFlow 
      nodes={nodes} 
      edges={edges} 
      onPaneClick={onPaneClick} 
      onNodeClick={onNodeClick} 
      fitView
    >
      <Background color="#f1f5f9" variant="dots" gap={20} />
      <Controls />
    </ReactFlow>
  );
}

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeNode, setActiveNode] = useState(null); 
  const [selectedNode, setSelectedNode] = useState(null); 
  const [renderMode, setRenderMode] = useState('clean');
  const [input, setInput] = useState('');
  
  // Resizing Logic
  const [leftWidth, setLeftWidth] = useState(60); 
  const isResizing = useRef(false);
  const chatEndRef = useRef(null);

  // --- RESIZER LOGIC ---
  const onResize = useCallback((e) => {
    if (!isResizing.current) return;
    const newWidth = (e.clientX / window.innerWidth) * 100;
    if (newWidth > 20 && newWidth < 80) {
      setLeftWidth(newWidth);
    }
  }, []);

  useEffect(() => {
    const stopResizing = () => { isResizing.current = false; };
    window.addEventListener('mousemove', onResize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', onResize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [onResize]);

  // --- GRAPH INITIALIZATION ---
  useEffect(() => {
    fetch('/graph').then(r => r.json()).then(data => {
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 100 });
      g.setDefaultEdgeLabel(() => ({}));

      const rawNodes = Array.isArray(data.nodes) ? data.nodes : Object.entries(data.nodes).map(([id, val]) => ({ id, ...val }));
      rawNodes.forEach(n => g.setNode(String(n.id), { width: NODE_WIDTH, height: NODE_HEIGHT }));
      data.edges.forEach(e => {
        if (g.hasNode(String(e.source)) && g.hasNode(String(e.target))) g.setEdge(String(e.source), String(e.target));
      });

      dagre.layout(g);

      setNodes(rawNodes.map(n => ({
        id: String(n.id),
        data: { label: n.name || n.id },
        position: { x: g.node(String(n.id)).x - NODE_WIDTH / 2, y: g.node(String(n.id)).y - NODE_HEIGHT / 2 },
        className: `material-node node-${n.id} ${n.id.includes('__') ? 'virtual' : ''}`,
      })));

      setEdges(data.edges.map((e, idx) => ({
        id: `edge-${idx}`,
        source: String(e.source),
        target: String(e.target),
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#1e293b' },
        className: `material-edge edge-from-${e.source}`
      })));
    });
  }, []);

  // --- MATERIAL STYLES ---
  const styles = useMemo(() => `
    .material-node { 
      background: #ffffff !important; 
      border: 1px solid #e2e8f0 !important; 
      border-radius: 12px !important; 
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
      color: #1e293b !important; 
      font-weight: 600 !important; 
      font-size: 13px !important; 
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }

    .virtual { opacity: 0.5; border-style: dashed !important; box-shadow: none !important; background: #f8fafc !important; }
    
    ${activeNode ? `
      .node-${activeNode} { 
        background: #0f172a !important; 
        color: #ffffff !important; 
        border-color: #0f172a !important;
        transform: scale(1.05); 
        box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1) !important;
      }
      .edge-from-${activeNode} path { stroke: #0f172a !important; stroke-width: 3px !important; }
    ` : ''}
    
    ${selectedNode ? `
      .node-${selectedNode} { 
        border: 2px solid #000 !important; 
        box-shadow: 0 0 0 4px rgb(0 0 0 / 0.05) !important;
      }
    ` : ''}

    .material-edge path { stroke: #94a3b8 !important; stroke-width: 1.5px; transition: stroke 0.3s ease; }

    .resizer-bar:hover { background: #cbd5e1 !important; }
    .resizer-bar:active { background: #94a3b8 !important; }

    .markdown-body h1, .markdown-body h2, .markdown-body h3 { border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 1.5em; }
    .markdown-body strong { font-weight: 700; color: #0f172a; }
  `, [activeNode, selectedNode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const val = input; setInput('');
    setMessages(p => [...p, { role: 'user', content: val }]);
    
    const res = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: val }) });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      decoder.decode(value).split('\n\n').forEach(line => {
        if (!line.startsWith('data: ')) return;
        if (line.includes('done')) { setActiveNode(null); return; }
        try {
          const data = JSON.parse(line.replace('data: ', ''));
          const node = Object.keys(data)[0];
          setActiveNode(node);
          setMessages(p => [...p, { role: 'assistant', node, content: data[node] }]);
        } catch (err) {}
      });
    }
  };

  useEffect(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', background: '#ffffff', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{styles}</style>
      
      {/* LEFT: GRAPH (Wrapped in Provider for FitView) */}
      <div style={{ width: `${leftWidth}%`, height: '100%', position: 'relative' }}>
        <ReactFlowProvider>
          <FlowInner 
            nodes={nodes} 
            edges={edges} 
            onNodeClick={(_, n) => setSelectedNode(n.id)} 
            onPaneClick={() => setSelectedNode(null)} 
          />
        </ReactFlowProvider>
      </div>

      {/* MATERIAL RESIZER */}
      <div 
        className="resizer-bar"
        onMouseDown={() => { isResizing.current = true; }}
        style={{ 
          width: '8px', 
          height: '100%', 
          cursor: 'col-resize', 
          background: '#f1f5f9', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          transition: 'background 0.2s',
          zIndex: 50 
        }}
      >
        <GripVertical size={14} color="#94a3b8" />
      </div>

      {/* RIGHT: TRACE */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#ffffff', borderLeft: '1px solid #e2e8f0' }}>
        <header style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '700', color: '#0f172a' }}>
            <Terminal size={18} /> SYSTEM TRACE
          </div>
          <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
            <button 
              onClick={() => setRenderMode('clean')} 
              style={{ padding: '8px 20px', border: 'none', background: renderMode === 'clean' ? '#ffffff' : 'transparent', color: renderMode === 'clean' ? '#0f172a' : '#64748b', cursor: 'pointer', fontSize: '11px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '10px', minWidth: '110px', borderRadius: '8px', boxShadow: renderMode === 'clean' ? '0 1px 3px 0 rgb(0 0 0 / 0.1)' : 'none', transition: 'all 0.2s' }}
            >
              <Eye size={14} /> CLEAN
            </button>
            <button 
              onClick={() => setRenderMode('raw')} 
              style={{ padding: '8px 20px', border: 'none', background: renderMode === 'raw' ? '#ffffff' : 'transparent', color: renderMode === 'raw' ? '#0f172a' : '#64748b', cursor: 'pointer', fontSize: '11px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '10px', minWidth: '110px', borderRadius: '8px', boxShadow: renderMode === 'raw' ? '0 1px 3px 0 rgb(0 0 0 / 0.1)' : 'none', transition: 'all 0.2s' }}
            >
              <Code size={14} /> RAW
            </button>
          </div>
        </header>

        <main style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#fbfcfd' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: '24px' }}>
              <div 
                onClick={() => m.node && setSelectedNode(m.node)}
                style={{ 
                  padding: '20px', borderRadius: '16px', background: '#ffffff', border: '1px solid #e2e8f0', 
                  boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)', cursor: 'pointer', transition: 'border 0.2s'
                }}
              >
                <div style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {m.role === 'user' ? <><User size={12}/> USER</> : m.node}
                </div>
                <div style={{ fontSize: '14px', lineHeight: 1.6, color: '#334155' }}>
                  {renderMode === 'clean' && m.role !== 'user' ? (
                    <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(m.content)}</ReactMarkdown></div>
                  ) : (
                    <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
                      {typeof m.content === 'object' ? JSON.stringify(m.content, null, 2) : m.content}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </main>

        <footer style={{ padding: '24px', borderTop: '1px solid #e2e8f0' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '12px' }}>
            <input 
              style={{ flex: 1, padding: '14px 20px', border: '1px solid #e2e8f0', outline: 'none', borderRadius: '12px', fontSize: '14px', background: '#f8fafc' }} 
              value={input} onChange={e => setInput(e.target.value)} placeholder="Send a message..." 
            />
            <button style={{ padding: '0 30px', background: '#0f172a', color: '#ffffff', border: 'none', fontWeight: '700', borderRadius: '12px', cursor: 'pointer', fontSize: '14px' }}>RUN</button>
          </form>
        </footer>
      </div>
    </div>
  );
}