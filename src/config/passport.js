const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const db = require('./mysql');
require('dotenv').config();

const opts = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET,
};

module.exports = (passport) => {
  passport.use(
    new JwtStrategy(opts, async (jwt_payload, done) => {
      try {
        if (jwt_payload.type === 'admin') {
          const admins = await db.query('SELECT * FROM admins WHERE id = ?', [jwt_payload.id]);
          if (admins.length > 0) {
            return done(null, { ...admins[0], type: 'admin' });
          }
        } else if (jwt_payload.type === 'user') {
          const users = await db.query('SELECT * FROM users WHERE id = ?', [jwt_payload.id]);
          if (users.length > 0) {
            return done(null, { ...users[0], type: 'user' });
          }
        }
        return done(null, false);
      } catch (err) {
        return done(err, false);
      }
    })
  );
};
