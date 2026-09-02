/**
 * Single-instance recharts primitives for §Charts consumers. Apps must import
 * chart marks from here (never from 'recharts' directly) so every mark shares
 * the exact module instance that ChartContainer wraps — two recharts copies in
 * one page render axes and legends but silently drop the marks.
 */
export {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
