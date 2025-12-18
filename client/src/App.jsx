import React, { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

// ====== Indicators helpers ======
function calcEMA(values, period) {
  // values: number[]
  const k = 2 / (period + 1);
  const ema = new Array(values.length).fill(null);

  if (values.length < period) return ema;

  // старт: SMA первых period значений
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prevEma = sum / period;
  ema[period - 1] = prevEma;

  // дальше EMA
  for (let i = period; i < values.length; i++) {
    const cur = values[i] * k + prevEma * (1 - k);
    ema[i] = cur;
    prevEma = cur;
  }

  return ema;
}

function calcRSI(closes, period = 14) {
  // Wilder RSI
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  rsi[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    rsi[i] = 100 - 100 / (1 + rs);
  }

  return rsi;
}

export default function App() {
  const candleContainerRef = useRef(null);
  const rsiContainerRef = useRef(null);

  const candleChartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeRef = useRef(null);
  const ema20Ref = useRef(null);
  const ema50Ref = useRef(null);

  const rsiChartRef = useRef(null);
  const rsiSeriesRef = useRef(null);
  const rsi30Ref = useRef(null);
  const rsi70Ref = useRef(null);

  const timerRef = useRef(null);

  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setIntervalTf] = useState("1m");
  const [isLive, setIsLive] = useState(true);
  const [lastUpdate, setLastUpdate] = useState("-");
  const [lastCandleTs, setLastCandleTs] = useState("-");

  // 1) Создаём два графика (свечи+объём) и (RSI)
  useEffect(() => {
    if (!candleContainerRef.current || !rsiContainerRef.current) return;

    // --- Candle chart ---
    const candleChart = createChart(candleContainerRef.current, {
      width: candleContainerRef.current.clientWidth,
      height: 520,
      layout: { background: { color: "#141722" }, textColor: "#DDD" },
      grid: { vertLines: { color: "#2b2b43" }, horLines: { color: "#2b2b43" } },
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const candleSeries = candleChart.addCandlestickSeries();
    candleSeriesRef.current = candleSeries;
    candleChartRef.current = candleChart;

    // Volume (внизу)
    const volumeSeries = candleChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeRef.current = volumeSeries;

    // EMA линии (поверх свечей)
    const ema20 = candleChart.addLineSeries({
      color: "#2196f3",
      lineWidth: 3,
    });
    const ema50 = candleChart.addLineSeries({
       color: "rgba(255, 152, 0, 0.9)", 
      lineWidth: 2,
    });
    ema20Ref.current = ema20;
    ema50Ref.current = ema50;

    // --- RSI chart ---
    const rsiChart = createChart(rsiContainerRef.current, {
      width: rsiContainerRef.current.clientWidth,
      height: 220,
      layout: { background: { color: "#141722" }, textColor: "#DDD" },
      grid: { vertLines: { color: "#2b2b43" }, horLines: { color: "#2b2b43" } },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: {
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });

    const rsiSeries = rsiChart.addLineSeries({ lineWidth: 2 });
    rsiSeriesRef.current = rsiSeries;
    rsiChartRef.current = rsiChart;

    // RSI уровни 30/70
    const rsi70 = rsiChart.addLineSeries({ lineWidth: 1 });
    const rsi30 = rsiChart.addLineSeries({ lineWidth: 1 });
    rsi70Ref.current = rsi70;
    rsi30Ref.current = rsi30;

    // Resize
    const onResize = () => {
      if (candleContainerRef.current && candleChartRef.current) {
        candleChartRef.current.applyOptions({
          width: candleContainerRef.current.clientWidth,
        });
      }
      if (rsiContainerRef.current && rsiChartRef.current) {
        rsiChartRef.current.applyOptions({
          width: rsiContainerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (timerRef.current) clearInterval(timerRef.current);
      candleChart.remove();
      rsiChart.remove();
      candleChartRef.current = null;
      rsiChartRef.current = null;
    };
  }, []);

  // 2) Загрузка свечей + расчёт EMA/RSI + отрисовка
  const loadCandles = async () => {
    try {
      const res = await fetch(
        `/binance/candles?symbol=${symbol}&interval=${interval}&limit=200`
      );

      if (!res.ok) {
        console.error("Backend error:", res.status, res.statusText);
        return;
      }

      const data = await res.json();

      // свечи в формат lightweight-charts
      const candles = data.candles.map((c) => ({
        time: Math.floor(new Date(c.ts).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      candleSeriesRef.current?.setData(candles);

      // volume
      const volumes = data.candles.map((c) => {
        const time = Math.floor(new Date(c.ts).getTime() / 1000);
        const isUp = Number(c.close) >= Number(c.open);
        return {
          time,
          value: Number(c.volume),
          color: isUp ? "rgba(38,166,154,0.8)" : "rgba(239,83,80,0.8)",
        };
      });
      volumeRef.current?.setData(volumes);

      // === EMA ===
      const closes = data.candles.map((c) => Number(c.close));
      const ema20Arr = calcEMA(closes, 20);
      const ema50Arr = calcEMA(closes, 50);

      const ema20Data = data.candles
        .map((c, i) => {
          const v = ema20Arr[i];
          if (v == null) return null;
          return {
            time: Math.floor(new Date(c.ts).getTime() / 1000),
            value: v,
          };
        })
        .filter(Boolean);

      const ema50Data = data.candles
        .map((c, i) => {
          const v = ema50Arr[i];
          if (v == null) return null;
          return {
            time: Math.floor(new Date(c.ts).getTime() / 1000),
            value: v,
          };
        })
        .filter(Boolean);

      ema20Ref.current?.setData(ema20Data);
      ema50Ref.current?.setData(ema50Data);

      // === RSI ===
      const rsiArr = calcRSI(closes, 14);
      const rsiData = data.candles
        .map((c, i) => {
          const v = rsiArr[i];
          if (v == null) return null;
          return {
            time: Math.floor(new Date(c.ts).getTime() / 1000),
            value: v,
          };
        })
        .filter(Boolean);

      rsiSeriesRef.current?.setData(rsiData);

      // линии 30/70 (на весь диапазон времени)
      if (candles.length > 0) {
        const t0 = candles[0].time;
        const t1 = candles[candles.length - 1].time;
        rsi70Ref.current?.setData([
          { time: t0, value: 70 },
          { time: t1, value: 70 },
        ]);
        rsi30Ref.current?.setData([
          { time: t0, value: 30 },
          { time: t1, value: 30 },
        ]);
      }

      setLastUpdate(new Date().toLocaleTimeString());
      const last = data.candles[data.candles.length - 1];
      if (last?.ts) setLastCandleTs(last.ts);
    } catch (e) {
      console.error("Ошибка загрузки свечей:", e);
    }
  };

  // 3) При смене symbol/tf — перезагрузка
  useEffect(() => {
    loadCandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  // 4) Live режим
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!isLive) return;

    timerRef.current = setInterval(loadCandles, 5000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, symbol, interval]);

  return (
    <div
      style={{
        padding: 14,
        background: "#0e0f15",
        minHeight: "100vh",
        color: "#fff",
        fontFamily: "system-ui, Arial, sans-serif",
      }}
    >
      <h1 style={{ margin: "0 0 12px 0" }}>📈 Binance Candles + EMA/RSI</h1>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 12,
          padding: 12,
          borderRadius: 12,
          background: "#111827",
          border: "1px solid #1f2937",
        }}
      >
        <label>
          Symbol:&nbsp;
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{ padding: "6px 10px" }}
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          Timeframe:&nbsp;
          <select
            value={interval}
            onChange={(e) => setIntervalTf(e.target.value)}
            style={{ padding: "6px 10px" }}
          >
            {INTERVALS.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => setIsLive((v) => !v)}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #374151",
            background: isLive ? "#0b3b2e" : "#3b0b0b",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {isLive ? "Stop Live" : "Start Live"}
        </button>

        <button
          onClick={loadCandles}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #374151",
            background: "#111827",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>

        <div style={{ opacity: 0.85 }}>
          <div>
            Live: <b>{isLive ? "ON" : "OFF"}</b>
          </div>
          <div>
            Updated: <b>{lastUpdate}</b>
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Last candle ts: {lastCandleTs}
          </div>
        </div>
      </div>

      {/* Candle + volume + EMA */}
      <div
        ref={candleContainerRef}
        style={{
          width: "100%",
          height: 520,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #2e371fff",
          marginBottom: 12,
        }}
      />

      {/* RSI */}
      <div
        ref={rsiContainerRef}
        style={{
          width: "100%",
          height: 220,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #1f3537ff",
        }}
      />
    </div>
  );
}
