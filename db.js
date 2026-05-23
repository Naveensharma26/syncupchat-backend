import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  ssl: {
    ca: fs.readFileSync("./isrgrootx1.pem"),
  },

  connectTimeout: 10000,
});

try {
  const conn = await db.getConnection();
  console.log("Connected to TiDB");
  conn.release();
} catch (err) {
  console.log("CODE:", err.code);
  console.log("MESSAGE:", err.message);
  console.log(err);
}

export default db;
