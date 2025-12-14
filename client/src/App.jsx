import React, { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

export default function App() {
  const chartContainerRef = useRef(null);

  // хранить chart/series в ref, чтобы не пересоздавать при каждом рендере
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const timerRef = useRef(null);

  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setIntervalTf] = useState("1m");
  const [isLive, setIsLive] = useState(true);
  const [lastUpdate, setLastUpdate] = useState("-");
  const [lastCandleTs, setLastCandleTs] = useState("-");

  // 1) Создаём график ОДИН РАЗ
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 520,
      layout: { background: { color: "#141722" }, textColor: "#DDD" },
      grid: { vertLines: { color: "#2b2b43" }, horLines: { color: "#2b2b43" } },
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const series = chart.addCandlestickSeries();

    chartRef.current = chart;
    seriesRef.current = series;

    // resize, чтобы не ломалось при изменении окна
    const onResize = () => {
      if (!chartContainerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (timerRef.current) clearInterval(timerRef.current);
      if (chartRef.current) chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // 2) Функция загрузки свечей (используется и для ручного refresh, и для live)
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

      const candles = data.candles.map((c) => ({
        time: Math.floor(new Date(c.ts).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      // кладём данные в график
      seriesRef.current?.setData(candles);

      // статус в UI
      const now = new Date().toLocaleTimeString();
      setLastUpdate(now);

      const last = data.candles[data.candles.length - 1];
      if (last?.ts) setLastCandleTs(last.ts);
    } catch (e) {
      console.error("Ошибка загрузки свечей:", e);
    }
  };

  // 3) При смене symbol или interval — перезагрузка данных
  useEffect(() => {
    loadCandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  // 4) Live-режим: включать/выключать таймер
  useEffect(() => {
    // чистим старый таймер
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!isLive) return;

    // стартуем новый таймер
    timerRef.current = setInterval(() => {
      loadCandles();
    }, 5000); //1000

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
      <h1 style={{ margin: "0 0 12px 0" }}>📈 Binance Candles</h1>

      {/* Панель управления */}
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

      {/* График */}
      <div
        ref={chartContainerRef}
        style={{
          width: "100%",
          height: 520,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #1f2937",
        }}
      />
    </div>
  );
}
