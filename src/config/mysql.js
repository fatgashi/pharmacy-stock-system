const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  port: process.env.MYSQL_PORT || 3306,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = {
  getConnection: async () => {
    return await pool.getConnection();
  },
  query: async (sql, params) => {
    const [results] = await pool.query(sql, params);
    return results;
  },
  execute: async (sql, params) => {
    const [results] = await pool.execute(sql, params);
    return results;
  },
};