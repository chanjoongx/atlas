import * as d3 from 'd3';
import type { AnnotatedLayout, LayoutNode, LayoutEdge } from '../types';

const COLORS = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#22d3ee', '#fb923c', '#4ade80', '#f87171', '#c084fc'
];
const BACKGROUND_COLOR = '#0a0e1a';
const DISTRICT_OPACITY = 0.28;
const DISTRICT_STROKE_OPACITY = 0.6;
const EDGE_OPACITY = 0.3;
const NODE_RADIUS = 4;
const ENTRY_NODE_SCALE = 1.5;
const CORE_NODE_STROKE = 2;
const HOTSPOT_OVERLAY = 'rgba(255, 140, 0, 0.4)';

interface RenderOptions {
  width: number;
  height: number;
}

interface NodeWithDistrict extends LayoutNode {
  district: string;
  highlightTypes: Set<string>;
  highlightReason?: string;
}

/**
 * Render City Map visualization using D3.js
 */
export function renderCityMap(
  svgElement: SVGSVGElement,
  layout: AnnotatedLayout,
  options?: Partial<RenderOptions>
): void {
  const svg = d3.select(svgElement);
  svg.selectAll('*').remove(); // Clear previous render

  const width = options?.width || svgElement.clientWidth || 1200;
  const height = options?.height || svgElement.clientHeight || 800;

  svg
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('background-color', BACKGROUND_COLOR);

  // Create main group for zoom/pan
  const g = svg.append('g').attr('class', 'main-group');

  // Define filters for effects
  const defs = svg.append('defs');

  // Glow filter for entry nodes
  const glowFilter = defs.append('filter').attr('id', 'glow');
  glowFilter
    .append('feGaussianBlur')
    .attr('stdDeviation', '3')
    .attr('result', 'coloredBlur');
  const feMerge = glowFilter.append('feMerge');
  feMerge.append('feMergeNode').attr('in', 'coloredBlur');
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Drop shadow for labels
  const shadowFilter = defs.append('filter').attr('id', 'drop-shadow');
  shadowFilter
    .append('feGaussianBlur')
    .attr('in', 'SourceAlpha')
    .attr('stdDeviation', '2');
  shadowFilter
    .append('feOffset')
    .attr('dx', '0')
    .attr('dy', '1')
    .attr('result', 'offsetblur');
  const feMerge2 = shadowFilter.append('feMerge');
  feMerge2.append('feMergeNode');
  feMerge2.append('feMergeNode').attr('in', 'SourceGraphic');

  // Color map for districts
  const districtColorMap = new Map<string, string>();
  layout.districts.forEach((district, i) => {
    districtColorMap.set(district.name, COLORS[i % COLORS.length]);
  });

  // Build node-to-district map
  const nodeDistrictMap = new Map<string, string>();
  layout.districts.forEach((district) => {
    district.nodes.forEach((nodeId) => {
      nodeDistrictMap.set(nodeId, district.name);
    });
  });

  // Build highlight map
  const highlightMap = new Map<string, { types: Set<string>; reason?: string }>();
  layout.highlights.forEach((highlight) => {
    const existing = highlightMap.get(highlight.nodeId);
    if (existing) {
      existing.types.add(highlight.type);
      if (!existing.reason) existing.reason = highlight.reason;
    } else {
      highlightMap.set(highlight.nodeId, {
        types: new Set([highlight.type]),
        reason: highlight.reason,
      });
    }
  });

  // Enrich nodes with district and highlight info
  const enrichedNodes: NodeWithDistrict[] = layout.nodes.map((node) => ({
    ...node,
    district: nodeDistrictMap.get(node.id) || 'unknown',
    highlightTypes: highlightMap.get(node.id)?.types || new Set(),
    highlightReason: highlightMap.get(node.id)?.reason,
  }));

  // Node lookup for edges
  const nodeMap = new Map<string, NodeWithDistrict>();
  enrichedNodes.forEach((node) => nodeMap.set(node.id, node));

  // Calculate bounds for layout
  const allX = layout.nodes.map((n) => n.x);
  const allY = layout.nodes.map((n) => n.y);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);

  const layoutWidth = maxX - minX || 1;
  const layoutHeight = maxY - minY || 1;

  const padding = 60;
  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;

  const scale = Math.min(
    availableWidth / layoutWidth,
    availableHeight / layoutHeight
  );

  const offsetX = (width - layoutWidth * scale) / 2;
  const offsetY = (height - layoutHeight * scale) / 2;

  const tx = (x: number) => (x - minX) * scale + offsetX;
  const ty = (y: number) => (y - minY) * scale + offsetY;

  // Render districts as background regions
  const districtGroup = g.append('g').attr('class', 'districts');
  layout.districts.forEach((district) => {
    const color = districtColorMap.get(district.name) || '#888';
    const bounds = district.bounds;

    districtGroup
      .append('rect')
      .attr('x', tx(bounds.x))
      .attr('y', ty(bounds.y))
      .attr('width', bounds.width * scale)
      .attr('height', bounds.height * scale)
      .attr('fill', color)
      .attr('opacity', DISTRICT_OPACITY)
      .attr('stroke', color)
      .attr('stroke-opacity', DISTRICT_STROKE_OPACITY)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4')
      .attr('rx', 12);
  });

  // Render district labels
  const districtLabelGroup = g.append('g').attr('class', 'district-labels');
  layout.districts.forEach((district) => {
    const color = districtColorMap.get(district.name) || '#888';
    const bounds = district.bounds;
    const centerX = tx(bounds.x + bounds.width / 2);
    const centerY = ty(bounds.y) - 8;

    districtLabelGroup
      .append('text')
      .attr('x', centerX)
      .attr('y', centerY)
      .attr('text-anchor', 'middle')
      .attr('fill', color)
      .attr('font-size', '13px')
      .attr('font-weight', '700')
      .attr('letter-spacing', '0.05em')
      .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)')
      .text(district.name.toUpperCase());
  });

  // Render edges
  const edgeGroup = g.append('g').attr('class', 'edges');
  layout.edges.forEach((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) return;

    const sourceColor = districtColorMap.get(source.district) || '#888';

    const link = d3
      .linkHorizontal<LayoutEdge, { x: number; y: number }>()
      .x((d) => d.x)
      .y((d) => d.y);

    edgeGroup
      .append('path')
      .attr('d', link({
        source: { x: tx(source.x), y: ty(source.y) },
        target: { x: tx(target.x), y: ty(target.y) },
      } as any))
      .attr('fill', 'none')
      .attr('stroke', sourceColor)
      .attr('stroke-width', 1)
      .attr('opacity', EDGE_OPACITY)
      .attr('class', 'edge');
  });

  // Render nodes
  const nodeGroup = g.append('g').attr('class', 'nodes');
  enrichedNodes.forEach((node) => {
    const color = districtColorMap.get(node.district) || '#888';
    const isEntry = node.highlightTypes.has('entry');
    const isCore = node.highlightTypes.has('core');
    const isHotspot = node.highlightTypes.has('hotspot');

    const nodeWidth = (isEntry ? node.width * ENTRY_NODE_SCALE : node.width) * scale;
    const nodeHeight = (isEntry ? node.height * ENTRY_NODE_SCALE : node.height) * scale;
    const saturation = node.highlightTypes.size > 0 ? 1.0 : 0.6;

    const nodeEl = nodeGroup
      .append('rect')
      .attr('x', tx(node.x) - nodeWidth / 2)
      .attr('y', ty(node.y) - nodeHeight / 2)
      .attr('width', nodeWidth)
      .attr('height', nodeHeight)
      .attr('rx', NODE_RADIUS)
      .attr('fill', d3.color(color)?.copy({ opacity: saturation }).toString() || color)
      .attr('class', 'node')
      .style('cursor', 'pointer');

    // Apply highlights
    if (isEntry) {
      nodeEl.attr('filter', 'url(#glow)');
      
      // Add pulsing animation
      nodeEl
        .append('animate')
        .attr('attributeName', 'opacity')
        .attr('values', '1;0.5;1')
        .attr('dur', '2s')
        .attr('repeatCount', 'indefinite');
    }

    if (isCore) {
      nodeEl.attr('stroke', 'white').attr('stroke-width', CORE_NODE_STROKE);
    }

    if (isHotspot) {
      nodeGroup
        .append('rect')
        .attr('x', tx(node.x) - nodeWidth / 2 - 2)
        .attr('y', ty(node.y) - nodeHeight / 2 - 2)
        .attr('width', nodeWidth + 4)
        .attr('height', nodeHeight + 4)
        .attr('rx', NODE_RADIUS + 1)
        .attr('fill', HOTSPOT_OVERLAY)
        .attr('pointer-events', 'none');
    }

    // Hover effects
    nodeEl
      .on('mouseenter', function (event) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('transform', `scale(1.05)`)
          .attr('transform-origin', `${tx(node.x)}px ${ty(node.y)}px`);

        // Show tooltip
        showTooltip(node, [event.clientX, event.clientY]);
      })
      .on('mouseleave', function () {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('transform', 'scale(1)');

        hideTooltip();
      });
  });

  // Render labels (only for highlighted nodes, max 25)
  const highlightedNodeIds = new Set(layout.highlights.map(h => h.nodeId));
  const filteredLabels = layout.labels
    .filter(label => highlightedNodeIds.has(label.nodeId))
    .slice(0, 25);

  const labelGroup = g.append('g').attr('class', 'labels');
  filteredLabels.forEach((label) => {
    const node = nodeMap.get(label.nodeId);
    if (!node) return;

    const labelX = tx(node.x);
    const labelY = ty(node.y);

    labelGroup
      .append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('fill', 'white')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'rgba(0,0,0,0.85)')
      .attr('stroke-width', '3px')
      .attr('stroke-linejoin', 'round')
      .text(label.text);
  });

  // Setup zoom and pan
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 5])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom as any);

  // Initial transform: identity (tx/ty already centers content correctly)
  svg.call(zoom.transform as any, d3.zoomIdentity);

  // Disable double-click zoom (prevent accidental jumps during demo)
  svg.on('dblclick.zoom', null);
}

// Tooltip management
let tooltipElement: HTMLDivElement | null = null;

function showTooltip(node: NodeWithDistrict, [x, y]: [number, number]): void {
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.style.position = 'fixed';
    tooltipElement.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    tooltipElement.style.color = 'white';
    tooltipElement.style.padding = '8px 12px';
    tooltipElement.style.borderRadius = '4px';
    tooltipElement.style.fontSize = '12px';
    tooltipElement.style.pointerEvents = 'none';
    tooltipElement.style.zIndex = '1000';
    tooltipElement.style.maxWidth = '300px';
    document.body.appendChild(tooltipElement);
  }

  const lines = [
    `<strong>${node.metadata.path}</strong>`,
    `Type: ${node.type}`,
    `LOC: ${node.metadata.loc}`,
    `Language: ${node.metadata.language}`,
  ];

  if (node.highlightTypes.size > 0) {
    lines.push(`Highlights: ${Array.from(node.highlightTypes).join(', ')}`);
    if (node.highlightReason) {
      lines.push(`Reason: ${node.highlightReason}`);
    }
  }

  tooltipElement.innerHTML = lines.join('<br>');
  tooltipElement.style.left = `${x + 10}px`;
  tooltipElement.style.top = `${y + 10}px`;
  tooltipElement.style.display = 'block';
}

function hideTooltip(): void {
  if (tooltipElement) {
    tooltipElement.style.display = 'none';
  }
}

// Made with Bob
