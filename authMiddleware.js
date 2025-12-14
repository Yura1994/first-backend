const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization']; // ожидаем "Bearer TOKEN"

    if (!authHeader) {
        return res.status(401).json({error:'Нет токена авторизации'});
        
    }

     const parts = authHeader.split(' ');
     
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Некорректный формат токена' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'SUPER_SECRET_KEY');
    req.user = decoded; // тут будет { id, email, iat, exp }
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Невалидный или просроченный токен' });
  }
}

module.exports = authMiddleware;