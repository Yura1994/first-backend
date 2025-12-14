require('dotenv').config();
const express = require ('express');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));
const app = express();
const pool = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authMiddleware = require('./authMiddleware');
const jwtSecret = process.env.JWT_SECRET;
// эта строка ОБЯЗАТЕЛЬНО должна быть выше всех роутов
app.use(express.json());

// app.get('/', (req, res) => {
//     res.send('Юра здесь! Backend работает 💪');
   
// });

// для сводки по активам

app.get('/portfolio/summary', authMiddleware, async (req, res) => {
    try {
         // 1. Берём агрегированные данные по активам
         const result = await pool.query(
            `SELECT asset_symbol, asset_type, currency,
                SUM(amount) AS total_amount,
                AVG(avg_price) AS avg_price,
                SUM (amount * avg_price) AS total_cost
                FROM positions
                WHERE user_id = $1
                GROUP BY asset_symbol, asset_type,currency`,
                [req.user.id] // <-- вот здесь подставляется $1
         );

         const positions = result.rows;

          // 2. Общая сумма вложений по всему портфелю
          const totalPortfolioCost = positions.reduce(
            (sum, p) => sum + Number(p.total_cost), 0
          );

           // 3. Добавим долю (%) каждого актива
           const withShare = positions.map((p) => {
            const cost = Number(p.total_cost);
            const share = totalPortfolioCost > 0 ? (cost / totalPortfolioCost) * 100 : 0;

            return{
                asset_symbol: p.asset_symbol,
                asset_type: p.asset_type,
                currency: p.currency,
                total_amount: Number(p.total_amount),
                avg_price: Number(p.avg_price),
                total_cost: cost,
                share_percent: Number(share.toFixed(2))
            };

           });

           res.json({
            total_invested: totalPortfolioCost,
            positions: withShare
           });

    } catch (error) {
            console.error(error);
            res.status(500).json({ error: error.message });
    }
});

// добавить актив
app.post('/positions', authMiddleware, async (req, res) => {
    try {
        const {asset_symbol, asset_type, amount, avg_price, currency} = req.body;

        if (!asset_symbol || !asset_type || !amount || !avg_price) {
            return res.status(400).json({ error: 'asset_symbol, asset_type, amount, avg_price обязательны' });

        }

    const result = await pool.query(
        `INSERT INTO positions (user_id, asset_symbol, asset_type, amount, avg_price, currency)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [req.user.id, asset_symbol, asset_type, amount, avg_price, currency || 'USD']
        );

    res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
    res.status(500).json({ error: error.message });
    }
});

// Получить все позиции текущего пользователя
app.get('/positions', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM positions WHERE user_id = $1',
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


// запись сделки 

app.post('/trades',authMiddleware, async (req, res) => {
    try {
        
        const{
            asset_symbol,
            asset_type,
            direction,
            amount,
            entry_price,
            exit_price,
            opened_at,
            closed_at
        } = req.body;

        // валидация
        if (!asset_symbol || !asset_type || !direction || !amount || !entry_price || !exit_price || !opened_at || !closed_at) {
            return res.status(400).json({ error: 'Все поля обязательны: asset_symbol, asset_type, direction, amount, entry_price, exit_price, opened_at, closed_at' });
        }

        if (direction !== 'LONG' && direction !== 'SHORT') {
            return res.status(400).json({ error: 'direction должен быть LONG или SHORT' });
        }

        const amt = Number(amount);
        const entry = Number(entry_price);
        const exit = Number(exit_price);

        //считаем pnl
        let pnl;
        if (direction == 'LONG') {
            pnl = (exit - entry) * amt;
        }else{
            pnl = (entry - exit) * amt;
        }

        const result = await pool.query(
            `INSERT INTO trades
                (user_id, asset_symbol, asset_type, direction, amount, entry_price, exit_price, pnl, opened_at, closed_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [
                req.user.id,
                asset_symbol,
                asset_type,
                direction,
                amt,
                entry,
                exit,
                pnl,
                opened_at,
                closed_at
            ]
    );

    res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({error: error.massage});
    }
});

    //список всех твоих сделок
app.get('/trades', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM trades WHERE user_id = $1 ORDER BY closed_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({error: error.massage});
    }
});

    //сводка по профиту
app.get('/trades/summary', authMiddleware, async (req, res) => {
    
    try {
        const result = await pool.query(
            `SELECT pnl FROM trades WHERE user_id = $1`,
            [req.user.id]
        );

        const trades = result.rows;

        if (trades.length === 0) {
            return res.json({
                total_pnl: 0,
                trades_count: 0,
                win_rate: 0,
                avg_win: 0,
                avg_loss: 0
            });
            
        }

        let totalPNL = 0;
        const wins = [];
        const losses = [];

        for(const t of trades){
            const v = Number(t.pnl);
            totalPNL += v;
            if(v > 0) wins.push(v);
            else if (v < 0) losses.push(v);
        }

        const tradesCount = trades.length;
        const winRate = wins.length > 0 ? (wins.length / tradesCount) * 100 : 0;

        const avgWin = wins.length ? wins.reduce((a, b) => a+ b, 0) / wins.length : 0;
        const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0; // будет отрицательный

        res.json({
            total_pnl: Number(totalPNL.toFixed(2)),
            trades_count: tradesCount,
            win_rate: Number(winRate.toFixed(2)),
            avg_win: Number(avgWin.toFixed(2)),
            avg_loss: Number(avgLoss.toFixed(2))
        });


    } catch (error) {
        console.error(error)
        res.status(500).json({error: error.massage});
    }
});


    // аналитика

app.get('/analysis/simple', authMiddleware, async (req, res) => {
    try {
        //получаем сводку портфеля
        const portfolioRes = await pool.query(
            `SELECT 
            asset_symbol,
            asset_type,
            currency,
            SUM(amount) AS total_amount,
            AVG(avg_price) AS avg_price,
            SUM(amount * avg_price) AS total_cost
            FROM positions
            WHERE user_id = $1
            GROUP BY asset_symbol, asset_type, currency`,
            [req.user.id]
        );

        const positions = portfolioRes.rows;
        if(positions.length === 0) {
            return res.json({ massage: "Портфель пуст. Добавьте активы."});
        }

        const totalCost = positions.reduce((sum, p) => sum + Number(p.total_cost), 0);

        //Получаем сводку трейдов

        const tradesRes = await pool.query(
            `SELECT pnl FROM trades WHERE user_id = $1`,
            [req.user.id]
        );

        const trades = tradesRes.rows;
        const tradesCount = trades.length;
        const wins = trades.filter(t => Number(t.pnl) > 0).length;
        const losses = trades.filter(t => Number(t.pnl) < 0).length;
        const winRate = tradesCount ? (wins / tradesCount) * 100 : 0;

        // Анализ концентрации и рисков
        let messages = [];

        const highRiskPositions = positions.filter(p => (Number(p.total_cost) / totalCost) > 0.4);

        if(highRiskPositions.length > 0){

      messages.push("⚠ Высокая концентрация: большой риск из-за вложения в 1 актив:");
      highRiskPositions.forEach(p => {
        const share = (Number(p.total_cost) / totalCost * 100).toFixed(2);
        messages.push(`- ${p.asset_symbol}: ${share}% портфеля`);
      });
    } else {
      messages.push("👍 Диверсификация портфеля выглядит здоровой.");
    }

    if (winRate === 100 && tradesCount > 1) {
      messages.push("⚠ Win Rate = 100%. Может быть ложное чувство уверенности без анализа лоссов.");
    }

    if (tradesCount === 0) {
      messages.push("ℹ Нет сделок — нечего анализировать по результатам трейдинга.");
    }

    messages.push("Это базовый анализ. Следующие версии будут включать цены, стакан, новости и паттерны рынка.");

    res.json({ analysis: messages });

    } catch (error) {
        console.error(error);
    res.status(500).json({ error: error.message });
    }
});


  //обновляет цену

  app.post('/prices/update', authMiddleware, async (req, res) => {
    try {
        const {asset_symbol, asset_type, price, currency} = req.body;

        if (!asset_symbol || !asset_type || !price) {
            return res.status(400).json({ error: 'asset_symbol, asset_type and price обязательны'});
        }

        const now  = new Date();

        // upsert: если запись уже есть – обновляем, если нет – вставляем
        const result = await pool.query(
            `INSERT INTO market_prices (asset_symbol, asset_type, price, currency, updated_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (asset_symbol, asset_type)
            DO UPDATE SET price = EXCLUDED.price,
                            currency = EXCLUDED.currency,
                            updated_at = EXCLUDED.updated_at
            RETURNING *`,
            [asset_symbol, asset_type, price, currency || 'USD', now]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.massage});
    }
  });

  app.get('/portfolio/live', authMiddleware, async (req, res) => {
    try{
        // 1.Берем все позиции пользователя
        const posRes = await pool.query(
            `SELECT * FROM positions WHERE user_id = $1`,
            [req.user.id]
        );
        const positions = posRes.rows;

        if(positions.length === 0) {
            return res.json({ massage: 'Портфель пуст'});
        }

        //2. Берем цены для всех символов
        const symbols = [...new Set(positions.map(p => p.asset_symbol))];

        const priceRes = await pool.query(
            `SELECT asset_symbol, asset_type,price, currency
            FROM market_prices
            WHERE asset_symbol = ANY($1::text[])`,
            [symbols]
        );

        const priceMap = {};
        for (const row of priceRes.rows) {
            priceMap[row.asset_symbol] = Number(row.price);
        }

        let totalValue = 0;
        const detailed = [];

        for(const p of positions){
            const amount = Number(p.amount);
            const avgPrice = Number(p.avg_price);
            const lastPrice = priceMap[p.asset_symbol] ??avgPrice;

            const valueNow = amount * lastPrice;
            const costBasis = amount * avgPrice;
            const unrealizedPnl = valueNow - costBasis;

            totalValue += valueNow;

            detailed.push({
                asset_symbol: p.asset_symbol,
                asset_type: p.asset_type,
                amount,
                avg_price: avgPrice,
                last_price: lastPrice,
                value_now: Number(valueNow.toFixed(2)),
                cost_basis: Number(costBasis.toFixed(2)),
                unrealized_pnl: Number(unrealizedPnl.toFixed(2))
            });
        }

        //Доли
        const withShare = detailed.map(d => ({
            ...d,
            share_percent: Number(((d.value_now / totalValue) * 100).toFixed(2))
        }));

        res.json({
            total_value: Number(totalValue.toFixed(2)),
            positions:withShare
        });

    }catch (error){
        console.error(error);
        res.status(500).json({ error: error.massage});
    }
  });


  

  app.post('/candles/upload', authMiddleware, async (req, res) => {
    try {
        const {asset_symbol, timeframe, candles} = req.body;

        if (!asset_symbol || !timeframe || !Array.isArray(candles)) {
            return res.status(400).json({ error: `asset_symbol, timeframe и candles обязательны`});
        }

        let inserted = 0;

        for (const c of candles) {
            // МЯГКАЯ проверка: просто убеждаемся, что поля есть
            if(!c.ts || c.open == null || c.high == null || c.low == null || c.close == null || c.volume == null) {
                console.log('пропущена свеча, нет полей:', c);
                continue;
            }
            

            await pool.query(
                `INSERT INTO candles (asset_symbol, timeframe, ts, open, high, low, close, volume)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,      
            [
                asset_symbol,
                timeframe,
                c.ts,
                c.open,
                c.high,
                c.low,
                c.close,
                c.volume
            ]
        ); 
           inserted++;        
        }

        // for (const v of values){
        //     await pool.query(
        //         `INSERT INTO candles (asset_symbol, timeframe, ts, open, high, low, close, volume)
        //         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        //         v
        //     );
        // }

        res.json({ message: `${inserted} свечей загружено` });
    } catch (error) {
            console.error(error);
            res.status(500).json({ error: error.message });
    }
  });


  app.get('/candles', authMiddleware, async (req, res) => {
    try {
        const {symbol, tf} = req.query;

        if(!symbol || !tf ){
            return res.status(400).json({ error: "symbol and tf обязательны"});
        }
        const result = await pool.query(
            `SELECT ts, open, high, low, close, volume
            FROM candles
            WHERE asset_symbol = $1 AND timeframe = $2
            ORDER BY ts ASC`,
            [symbol, tf]  
        );
    
        res.json({ symbol, tf, candles: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
  });


app.get('/binance/candles', async (req, res) => {
  try {
    const { symbol, interval, limit } = req.query;

    // Например: symbol=BTCUSDT, interval=1h, limit=100
    if (!symbol || !interval) {
      return res.status(400).json({ error: 'symbol и interval обязательны (например BTCUSDT и 1h)' });
    }

    const lim = limit || 200;

    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${lim}`;

    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: 'Ошибка ответа Binance', details: text });
    }

    const data = await response.json();

    // Binance возвращает массив массивов:
    // [ openTime, open, high, low, close, volume, closeTime, ... ]
    const candles = data.map(c => ({
      ts: new Date(c[0]).toISOString(),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5])
    }));

    res.json({
      symbol,
      interval,
      candles
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});










/////////////////////////////////////////////////////////////////////////////////////////////////////

//Регистрация
app.post('/auth/register', async (req,res) => {
    try {
        const {name, email, password} = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email и password обязательны' });
        }

         // 1. Проверим, нет ли такого email уже
         const existing = await pool.query(' SELECT id FROM users WHERE email = $1', [email]);
         if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует'});
         }
         
         // 2. Хэшируем пароль
         const saltRounds = 10;
         const passwordHash = await bcrypt.hash(password, saltRounds);

         // 3. Сохраняем в базу
         const result = await pool.query(
            'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
            [name, email, passwordHash]
         );

         // 4. Возвращаем созданного пользователя (без пароля)
         res.status(201).json(result.rows[0]);
    } catch (error){
        console.error(error);
        res.status(500).json({ error: error.massage});
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const {email, password} = req.body;

        if (!email || !password) {
            return res.status(400).json({error: 'Email и password обязательны' });
        }

        // 1. Ищем пользователя по email
        const result = await pool.query(
            'SELECT id, name, email, password_hash FROM users WHERE email = $1',
           [email]
        );
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Неверный email или пароль' });
        }

        const user = result.rows[0];

        // 2. Сравниваем пароль с хэшем

        const token = jwt.sign(
            {id: user.id, email: user.email},
            jwtSecret,  // в .env
            { expiresIn: '7d' }  // токен действует 7 дней
        );

        // 4. Отправляем токен и инфу о пользователе
        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            },
            token
        });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.massage});
    }
});

app.get('/me', authMiddleware, (req, res) => {
    res.json({ message: 'Привет, защищённый мир!', user: req.user});
});




app.get('/users', async (req, res)=> {
    try{
        const users = await pool.query('SELECT * FROM users');
        res.json(users.rows);
    }catch(error){
        res.status(500).json({error: error.massage});
    }
});


// POST - добавить пользователя
app.post('/users', async (req, res) =>{
    try{
        const {name, email} = req.body; // достаем данные из тела запроса
        
        //простая проверк - есть ли данные
        if (!name || !email) {
            return res.status(400).json({ error: 'Name and email Error'});
        }

        // защищенный запрос - параметры вместо конкатенации строк
        const result = await pool.query(
            'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
            [name,email]
        );

        // 201 - "успешно создано"
        res.status(201).json(result.rows[0]);
    }catch (error) {
        // если email уже существует - тоже может выкинуть ошибку уникальности
        console.error(error);
        res.status(500).json({ error: error.massage});
    }
});



app.listen(5000, () => {
    console.log('Server is running on http://localhost:5000');
});