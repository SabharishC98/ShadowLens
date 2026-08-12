import { useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import type { ObserverEvent } from '../services/api';

const NODES = [
  { id: 'INPUT_VALIDATOR', label: 'Input Validator', short: 'IV' },
  { id: 'ORCHESTRATOR',    label: 'Orchestrator',    short: 'OR' },
  { id: 'TOOL_CALLER',     label: 'Tool Caller',     short: 'TC' },
  { id: 'RESPONDER',       label: 'Responder',       short: 'RS' },
];

const LINKS = [
  { source: 'INPUT_VALIDATOR', target: 'ORCHESTRATOR' },
  { source: 'ORCHESTRATOR',    target: 'TOOL_CALLER'  },
  { source: 'TOOL_CALLER',     target: 'RESPONDER'    },
];

const colorScale = d3.scaleLinear<string>()
  .domain([0, 0.35, 0.7, 1.0])
  .range(['#00ff66', '#fbbf24', '#ff003c', '#ff003c']);

interface Props {
  events: ObserverEvent[];
  onEdgeClick?: (event: ObserverEvent) => void;
}

export default function AttackGraph({ events, onEdgeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const edgeDataRef = useRef<Record<string, ObserverEvent>>({});

  const draw = useCallback(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const W = svgRef.current?.clientWidth  || 800;
    const H = svgRef.current?.clientHeight || 420;

    // Background grid
    const defs = svg.append('defs');
    const pattern = defs.append('pattern')
      .attr('id', 'grid').attr('width', 40).attr('height', 40)
      .attr('patternUnits', 'userSpaceOnUse');
    pattern.append('path')
      .attr('d', 'M 40 0 L 0 0 0 40')
      .attr('fill', 'none').attr('stroke', 'rgba(0,255,102,0.025)').attr('stroke-width', 1);
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#grid)');

    // Glow filter
    const filter = defs.append('filter').attr('id', 'glow');
    filter.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'coloredBlur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Node positions (horizontal pipeline layout)
    const nodeSpacing = W / (NODES.length + 1);
    const nodePositions: Record<string, { x: number; y: number }> = {};
    NODES.forEach((n, i) => {
      nodePositions[n.id] = { x: nodeSpacing * (i + 1), y: H / 2 };
    });

    // Draw edges
    LINKS.forEach(link => {
      const src  = nodePositions[link.source];
      const tgt  = nodePositions[link.target];
      const key  = `${link.source}->${link.target}`;
      const evt  = edgeDataRef.current[key];
      const conf = evt?.injection_confidence ?? 0;
      const color= colorScale(conf);
      const thick= 1 + (conf * 6);

      // Animated flow line
      const g = svg.append('g').attr('class', 'edge-group').style('cursor', 'pointer');

      // Shadow glow for injected edges
      if (conf > 0.3) {
        g.append('line')
          .attr('x1', src.x).attr('y1', src.y).attr('x2', tgt.x).attr('y2', tgt.y)
          .attr('stroke', color).attr('stroke-width', thick + 4)
          .attr('stroke-opacity', 0.25).attr('filter', 'url(#glow)');
      }

      g.append('line')
        .attr('x1', src.x).attr('y1', src.y).attr('x2', tgt.x).attr('y2', tgt.y)
        .attr('stroke', color).attr('stroke-width', thick)
        .attr('stroke-opacity', 0.85)
        .attr('stroke-linecap', 'square');

      // Arrowhead
      const angle = Math.atan2(tgt.y - src.y, tgt.x - src.x);
      const ax = tgt.x - 26 * Math.cos(angle);
      const ay = tgt.y - 26 * Math.sin(angle);
      g.append('polygon')
        .attr('points', `0,-5 10,0 0,5`)
        .attr('transform', `translate(${ax},${ay}) rotate(${(angle * 180) / Math.PI})`)
        .attr('fill', color).attr('opacity', 0.85);

      // Confidence label on edge midpoint
      if (conf > 0) {
        g.append('text')
          .attr('x', (src.x + tgt.x) / 2)
          .attr('y', (src.y + tgt.y) / 2 - 12)
          .attr('text-anchor', 'middle')
          .attr('fill', color)
          .attr('font-size', '11px')
          .attr('font-family', 'Share Tech Mono, monospace')
          .attr('font-weight', '600')
          .text(conf.toFixed(2));
      }

      // Click handler
      if (evt && onEdgeClick) {
        g.on('click', () => onEdgeClick(evt));
      }
    });

    // Draw nodes
    NODES.forEach(node => {
      const { x, y } = nodePositions[node.id];
      const hasEvent  = Object.keys(edgeDataRef.current).some(k => k.startsWith(node.id));
      const nodeEvent = Object.values(edgeDataRef.current).find(e => e.sender_node === node.id);
      const injected  = nodeEvent?.injection_detected ?? false;

      const g = svg.append('g').attr('transform', `translate(${x},${y})`);

      // Outer ring (injected indicator)
      if (injected) {
        g.append('circle').attr('r', 30).attr('fill', 'none')
          .attr('stroke', '#ff003c').attr('stroke-width', 2).attr('opacity', 0.6)
          .attr('stroke-dasharray', '4 2');
      }

      // Node circle
      g.append('circle').attr('r', 22)
        .attr('fill', injected ? 'rgba(255,0,60,0.15)' : 'rgba(0,255,102,0.06)')
        .attr('stroke', injected ? '#ff003c' : '#00ff66')
        .attr('stroke-width', 2);

      // Short label inside node
      g.append('text')
        .attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('fill', injected ? '#ff3355' : '#ffffff')
        .attr('font-size', '11px').attr('font-weight', '700')
        .attr('font-family', 'Share Tech Mono, monospace')
        .text(node.short);

      // Node label below
      g.append('text')
        .attr('text-anchor', 'middle').attr('dy', '44px')
        .attr('fill', 'rgba(0, 255, 102, 0.65)').attr('font-size', '11px').attr('font-weight', '600')
        .attr('font-family', 'Share Tech Mono, monospace')
        .text(node.label);

      // Goal violated badge
      if (nodeEvent?.goal_violated) {
        g.append('circle').attr('cx', 15).attr('cy', -15).attr('r', 6)
          .attr('fill', '#ff003c');
        g.append('text').attr('x', 15).attr('y', -12)
          .attr('text-anchor', 'middle').attr('fill', '#ffffff')
          .attr('font-size', '8px').attr('font-weight', '800')
          .text('!');
      }
    });

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${W - 180}, 20)`);
    legend.append('rect').attr('width', 170).attr('height', 80)
      .attr('rx', 0).attr('fill', 'rgba(0,0,0,0.85)').attr('stroke', 'rgba(0, 255, 102, 0.2)');
    const legendItems = [
      { color: '#00ff66', label: 'Safe (0.0–0.3)' },
      { color: '#fbbf24', label: 'Medium (0.3–0.7)' },
      { color: '#ff003c', label: 'Injected (0.7–1.0)' },
    ];
    legendItems.forEach((item, i) => {
      legend.append('rect').attr('x', 12).attr('y', 12 + i * 22)
        .attr('width', 12).attr('height', 4).attr('rx', 0).attr('fill', item.color);
      legend.append('text').attr('x', 32).attr('y', 16 + i * 22)
        .attr('fill', 'rgba(255, 255, 255, 0.75)').attr('font-size', '11px').text(item.label);
    });
  }, [onEdgeClick]);

  // Rebuild graph on events change
  useEffect(() => {
    events.forEach(e => {
      const key = `${e.sender_node}->${e.receiver_node}`;
      edgeDataRef.current[key] = e;
    });
    draw();
  }, [events, draw]);

  // Handle resize
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (svgRef.current) ro.observe(svgRef.current);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <svg
      ref={svgRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
