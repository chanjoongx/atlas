import * as d3 from 'd3';
import type { AnnotatedLayout, LayoutNode, LayoutEdge } from '../types';

const COLORS = d3.schemeTableau10;
const BACKGROUND_COLOR = '#0a0e1a';
const DISTRICT_OPACITY = 0.12;
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

  const padding = 50;
  const xScale = d3
    .scaleLinear()
    .domain([minX, maxX])
    .range([padding, width - padding]);
  const yScale = d3
    .scaleLinear()
    .domain([minY, maxY])
    .range([padding, height - padding]);

  // Render districts as background regions
  const districtGroup = g.append('g').attr('class', 'districts');
  layout.districts.forEach((district) => {
    const color = districtColorMap.get(district.name) || '#888';
    const bounds = district.bounds;

    districtGroup
      .append('rect')
      .attr('x', xScale(bounds.x))
      .attr('y', yScale(bounds.y))
      .attr('width', xScale(bounds.x + bounds.width) - xScale(bounds.x))
      .attr('height', yScale(bounds.y + bounds.height) - yScale(bounds.y))
      .attr('fill', color)
      .attr('opacity', DISTRICT_OPACITY)
      .attr('rx', 8);
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
        source: { x: xScale(source.x), y: yScale(source.y) },
        target: { x: xScale(target.x), y: yScale(target.y) },
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

    const size = isEntry ? 12 * ENTRY_NODE_SCALE : 12;
    const saturation = node.highlightTypes.size > 0 ? 1.0 : 0.6;

    const nodeEl = nodeGroup
      .append('rect')
      .attr('x', xScale(node.x) - size / 2)
      .attr('y', yScale(node.y) - size / 2)
      .attr('width', size)
      .attr('height', size)
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
        .attr('x', xScale(node.x) - size / 2 - 2)
        .attr('y', yScale(node.y) - size / 2 - 2)
        .attr('width', size + 4)
        .attr('height', size + 4)
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
          .attr('transform-origin', `${xScale(node.x)}px ${yScale(node.y)}px`);

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

  // Render labels
  const labelGroup = g.append('g').attr('class', 'labels');
  layout.labels.forEach((label) => {
    const node = nodeMap.get(label.nodeId);
    if (!node) return;

    // Calculate label position based on position hint
    let labelX = xScale(node.x);
    let labelY = yScale(node.y);
    let anchor: 'start' | 'middle' | 'end' = 'middle';

    switch (label.position) {
      case 'top':
        labelY -= 20;
        break;
      case 'bottom':
        labelY += 25;
        break;
      case 'left':
        labelX -= 20;
        anchor = 'end';
        break;
      case 'right':
        labelX += 20;
        anchor = 'start';
        break;
    }

    labelGroup
      .append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', anchor)
      .attr('fill', 'white')
      .attr('font-size', '14px')
      .attr('font-weight', '600')
      .attr('filter', 'url(#drop-shadow)')
      .text(label.text);
  });

  // Setup zoom and pan
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.5, 3])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom as any);
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
