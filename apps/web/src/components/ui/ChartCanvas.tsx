import { useEffect, useRef } from 'preact/hooks';
import {
  Chart,
  LineController,
  BarController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
  type ChartConfiguration,
  type ChartType,
} from 'chart.js';

Chart.register(
  LineController,
  BarController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
);

const ACCENT = '#a78bfa';
const ACCENT_2 = '#e879f9';
const MUTED = 'rgb(161 161 170 / 0.85)';
const GRID = 'rgb(255 255 255 / 0.06)';

type Props = {
  type: ChartType;
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    fill?: boolean;
  }[];
  class?: string;
  height?: number;
  legend?: boolean;
};

export function ChartCanvas({
  type,
  labels,
  datasets,
  class: className,
  height = 220,
  legend = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    chartRef.current?.destroy();

    const colors = [ACCENT, ACCENT_2, '#818cf8', '#34d399'];
    const config: ChartConfiguration = {
      type,
      data: {
        labels,
        datasets: datasets.map((ds, i) => {
          const color = colors[i % colors.length];
          if (type === 'doughnut') {
            return {
              label: ds.label,
              data: ds.data,
              backgroundColor: [ACCENT, ACCENT_2, '#6366f1', '#27272a'],
              borderWidth: 0,
            };
          }
          return {
            label: ds.label,
            data: ds.data,
            borderColor: color,
            backgroundColor:
              type === 'line'
                ? 'rgb(167 139 250 / 0.12)'
                : 'rgb(167 139 250 / 0.35)',
            fill: ds.fill ?? type === 'line',
            tension: 0.35,
            borderWidth: 2,
            pointRadius: type === 'line' ? 0 : undefined,
            pointHoverRadius: 4,
            borderRadius: type === 'bar' ? 6 : undefined,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: legend,
            labels: { color: MUTED, boxWidth: 10, font: { family: 'Outfit', size: 12 } },
          },
          tooltip: {
            backgroundColor: '#18181b',
            titleColor: '#fafafa',
            bodyColor: MUTED,
            borderColor: 'rgb(255 255 255 / 0.1)',
            borderWidth: 1,
            padding: 10,
          },
        },
        scales:
          type === 'doughnut'
            ? undefined
            : {
                x: {
                  grid: { color: GRID, drawBorder: false },
                  ticks: { color: MUTED, font: { family: 'Outfit', size: 11 } },
                  border: { display: false },
                },
                y: {
                  grid: { color: GRID, drawBorder: false },
                  ticks: { color: MUTED, font: { family: 'Outfit', size: 11 } },
                  border: { display: false },
                  beginAtZero: true,
                },
              },
      },
    };

    chartRef.current = new Chart(el, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [type, labels.join('|'), JSON.stringify(datasets), legend]);

  return (
    <div class={className} style={{ height: `${height}px` }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
