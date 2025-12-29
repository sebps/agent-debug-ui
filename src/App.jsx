import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ReactFlow, Background, MarkerType, Controls, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import dagre from 'dagre';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '@xyflow/react/dist/style.css';
import { Terminal, Search, GripVertical, Cpu, Plus, Code, Box, Database, Layers } from 'lucide-react';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;
const SIDEBAR_WIDTH = 280;

function FlowInner({ nodes, edges }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => fitView({ duration: 400, padding: 0.2 }), 50);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, fitView]);
  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.05} maxZoom={1.5}>
        <Background color="#f1f5f9" variant="dots" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [search, setSearch] = useState('');
  const [currentThreadId, setCurrentThreadId] = useState(`debug-${Date.now()}`);
  const [isStateful, setIsStateful] = useState(false);
  const [activeNode, setActiveNode] = useState(null);
  const [graphWidth, setGraphWidth] = useState(600); 

  const containerRef = useRef(null);
  const isResizing = useRef(false);
  const chatEndRef = useRef(null);

  // --- STABLE RESIZER ---
  const startResizing = useCallback(() => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const overlay = document.createElement('div');
    overlay.id = 'resize-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:col-resize;';
    document.body.appendChild(overlay);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!isResizing.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const sidebarOffset = isStateful ? SIDEBAR_WIDTH : 0;
      const newWidth = e.clientX - rect.left - sidebarOffset;
      if (newWidth > 150 && newWidth < (rect.width - sidebarOffset - 250)) setGraphWidth(newWidth);
    };
    const onUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
        document.getElementById('resize-overlay')?.remove();
      }
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isStateful]);

  // --- GRAPH LOADER (Nodes is an object per memory) ---
  useEffect(() => {
    fetch('/graph').then(r => r.json()).then(data => {
      setIsStateful(data.isStateful);
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80 });
      g.setDefaultEdgeLabel(() => ({}));
      
      // Nodes is an Object
      const raw = Object.entries(data.nodes).map(([id, val]) => ({ id: String(id), ...val }));
      raw.forEach(n => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
      
      const validEdges = data.edges.filter(e => g.hasNode(String(e.source)) && g.hasNode(String(e.target)));
      validEdges.forEach(e => g.setEdge(String(e.source), String(e.target)));
      
      dagre.layout(g);
      
      setNodes(raw.map(n => ({
        id: n.id, data: { label: n.name || n.id },
        position: { x: g.node(n.id).x - NODE_WIDTH/2, y: g.node(n.id).y - NODE_HEIGHT/2 },
        className: `material-node node-${n.id} ${n.id.includes('__') ? 'virtual' : ''}`
      })));
      setEdges(validEdges.map((e, i) => ({ id: `e-${i}`, source: String(e.source), target: String(e.target), type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } })));
    });
  }, []);

  useEffect(() => {
    if (isStateful) fetch(`/threads${search ? `?thread_id=${search}` : ''}`).then(r => r.json()).then(setThreads);
  }, [search, isStateful, messages.length]);

  const loadThread = (id) => {
    setCurrentThreadId(id);
    fetch(`/history/${id}`).then(r => r.json()).then(setMessages);
  };

  const onRun = async (e) => {
    e.preventDefault();
    const input = e.target.elements.input;
    const val = input.value; if (!val) return;
    input.value = '';
    
    // Optimistic user update
    setMessages(prev => [...prev, { node: 'user', updates: { messages: [{ content: val, role: 'user' }] } }]);
    
    const res = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: val, threadId: currentThreadId }) });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      decoder.decode(value).split('\n\n').forEach(line => {
        if (!line.startsWith('data: ')) return;
        try {
          const data = JSON.parse(line.replace('data: ', ''));
          if (data.node) setActiveNode(data.node);
          if (data.content && data.content !== "...") {
            setMessages(p => [...p, { node: data.node, updates: { messages: [{ content: data.content, role: 'assistant' }] } }]);
          }
        } catch(e) {}
      });
    }
    setActiveNode(null);
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  return (
    <div ref={containerRef} style={{ display: 'flex', width: '100vw', height: '100vh', background: '#fff', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        .material-node { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; font-weight: 600; font-size: 11px; display: flex; align-items: center; justify-content: center; width: ${NODE_WIDTH}px; height: ${NODE_HEIGHT}px; transition: 0.3s; }
        .virtual { opacity: 0.4; border-style: dashed; }
        ${activeNode ? `.node-${activeNode} { background: #0f172a !important; color: #fff !important; transform: scale(1.08); z-index: 1000; box-shadow: 0 10px 20px rgba(0,0,0,0.15); }` : ''}
        .resizer-bar:hover { background: #cbd5e1 !important; }
      `}</style>
      
      {/* THREAD EXPLORER */}
      {isStateful && (
        <aside style={{ width: `${SIDEBAR_WIDTH}px`, background: '#f8fafc', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '20px', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', letterSpacing: '0.05em' }}>THREADS</span>
              <Plus size={16} onClick={() => { setCurrentThreadId(`debug-${Date.now()}`); setMessages([]); }} style={{ cursor: 'pointer' }} />
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
              <input style={{ width: '100%', padding: '8px 8px 8px 32px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', boxSizing: 'border-box' }} placeholder="Search threads..." onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {threads.map(t => (
              <div key={t.id} onClick={() => loadThread(t.id)} style={{ padding: '12px', background: currentThreadId === t.id ? '#fff' : 'transparent', border: currentThreadId === t.id ? '1px solid #0f172a' : '1px solid transparent', borderRadius: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#1e293b' }}>{t.id}</div>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>{new Date(t.updatedAt).toLocaleTimeString()}</div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* GRAPH PANEL */}
      <div style={{ width: `${graphWidth}px`, height: '100%', position: 'relative', flexShrink: 0, overflow: 'hidden', background: '#fbfcfd' }}>
        <ReactFlowProvider><FlowInner nodes={nodes} edges={edges} /></ReactFlowProvider>
      </div>

      <div onMouseDown={startResizing} className="resizer-bar" style={{ width: '10px', cursor: 'col-resize', background: '#f1f5f9', borderLeft: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, flexShrink: 0 }}><GripVertical size={14} color="#94a3b8" /></div>

      {/* TRACE PANEL */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#fff' }}>
        <header style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0', fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={16} /> {currentThreadId}
        </header>
        
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#f8fafc' }}>
          {messages.map((step, i) => (
            <div key={i} onMouseEnter={() => setActiveNode(step.node)} onMouseLeave={() => setActiveNode(null)} style={{ marginBottom: '24px', border: '1px solid #e1e7ef', borderRadius: '12px', background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
              <div style={{ padding: '8px 16px', background: '#f1f5f9', borderBottom: '1px solid #e1e7ef', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cpu size={14} color="#64748b" />
                <span style={{ fontSize: '10px', fontWeight: '900', color: '#475569' }}>{(step.node || 'SYSTEM').toUpperCase()}</span>
              </div>
              
              <div style={{ padding: '16px' }}>
                {Object.entries(step.updates || {}).map(([key, value]) => {
                  
                  // Heuristic: Is it a message list?
                  const isMessageList = Array.isArray(value) && value.length > 0 && (value[0].content || value[0].kwargs);
                  
                  if (isMessageList) {
                    return value.map((m, idx) => (
                      <div key={idx} style={{ marginBottom: idx === value.length - 1 ? 0 : 12, fontSize: '14px', lineHeight: 1.6, color: '#334155' }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || m.kwargs?.content || ""}</ReactMarkdown>
                      </div>
                    ));
                  }

                  // Heuristic: Is it a simple string?
                  if (typeof value === 'string') {
                    return (
                      <div key={key} style={{ marginTop: '14px' }}>
                        <div style={{ fontSize: '9px', fontWeight: '900', color: '#94a3b8', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}><Database size={10}/> {key.toUpperCase()}</div>
                        <div style={{ fontSize: '13px', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#1e293b', padding: '12px', borderRadius: '8px', whiteSpace: 'pre-wrap' }}>{value}</div>
                      </div>
                    );
                  }

                  // Heuristic: It's complex data (JSON)
                  return (
                    <div key={key} style={{ marginTop: '14px' }}>
                      <div style={{ fontSize: '9px', fontWeight: '900', color: '#94a3b8', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}><Box size={10}/> {key.toUpperCase()}</div>
                      <pre style={{ fontSize: '11px', background: '#1e293b', color: '#e2e8f0', padding: '12px', borderRadius: '8px', overflowX: 'auto', margin: 0 }}>{JSON.stringify(value, null, 2)}</pre>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </main>
        
        <footer style={{ padding: '20px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
          <form onSubmit={onRun} style={{ display: 'flex', gap: '8px' }}>
            <input name="input" style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', outline: 'none' }} placeholder="Type input to the graph..." autoComplete="off" />
            <button type="submit" style={{ padding: '0 24px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer' }}>RUN</button>
          </form>
        </footer>
      </div>
    </div>
  );
}