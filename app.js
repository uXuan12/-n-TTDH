const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { Pool } = require("pg");
const fs = require("fs");
const proj4 = require("proj4");
const bcrypt = require("bcrypt");

const app = express();

// Tạo kết nối tới PostgreSQL

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "QL_xe_bus",
  password: "Admin", // Đảm bảo mật khẩu ở đây là một chuỗi
  port: 5433,
});

// Cấu hình session
app.use(
  session({
    secret: "my_secret_key", // Mã bí mật để bảo vệ session
    resave: false, // Không lưu lại session nếu không thay đổi
    saveUninitialized: true, // Lưu session mặc dù chưa được khởi tạo
    cookie: { secure: false }, // Thiết lập cookie cho session (sử dụng secure: true khi chạy trên HTTPS)
  })
);
// Cấu hình Passport
app.use(passport.initialize());
app.use(passport.session());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // Cung cấp quyền truy cập vào thư mục public

// Middleware để xử lý JSON nếu cần
app.use(express.json());

// Thiết lập view engine
// Cấu hình EJS
app.set("view engine", "ejs");
app.set("views", "./views");

// Người dùng mẫu
const users = [];

// Passport: Lưu thông tin người dùng vào session
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});
passport.use(
  new GoogleStrategy(
    {
      clientID:
        "205442421545-pjavfpkccgh9n4r4bopqpsn0corhj480.apps.googleusercontent.com", // Thay bằng Client ID của bạn
      clientSecret: "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", // Thay bằng Client Secret của bạn
      callbackURL: "http://localhost:3000/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        const displayName = profile.displayName;
        const avatar = profile.photos[0].value;

        // Kiểm tra xem người dùng đã tồn tại trong CSDL chưa
        const userQuery = "SELECT * FROM nguoi_dung WHERE email = $1";
        const userResult = await pool.query(userQuery, [email]);

        let user;
        if (userResult.rows.length > 0) {
          // Người dùng đã tồn tại
          user = userResult.rows[0];
        } else {
          // Người dùng chưa tồn tại, thêm mới
          const insertQuery = `
                        INSERT INTO nguoi_dung (ten_nguoi_dung, quyen_quan_tri, trang_thai, email, avatar)
                        VALUES ($1, false, false, $2, $3)
                        RETURNING *;
                    `;
          const insertResult = await pool.query(insertQuery, [
            displayName,
            email,
            avatar,
          ]);
          user = insertResult.rows[0];
        }

        // Gọi done để lưu người dùng vào session
        done(null, user);
      } catch (err) {
        console.error("Error handling user authentication:", err);
        done(err, null);
      }
    }
  )
);

// // Routes
// app.get('/', (req, res) => {
//     res.render('login', { user: req.user });
// });

app.get("/", (req, res) => {
  // Kiểm tra nếu user đã đăng nhập và có quyền quản trị
  if (req.user && req.user.quyen_quan_tri) {
    return res.redirect("/dashboard"); // Nếu có quyền quản trị, chuyển hướng đến dashboard
  }

  // Nếu không, render trang chủ bình thường
  res.render("index", { user: req.user || null });
});

// Google Auth Routes
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);
app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    // Kiểm tra quyền của người dùng
    if (req.user.quyen_quan_tri) {
      return res.redirect("/dashboard"); // Người dùng có quyền quản trị
    } else {
      return res.redirect("/"); // Người dùng bình thường
    }
  }
);

// Route kiểm tra kết nối cơ sở dữ liệu
app.get("/test_connection", async (req, res) => {
  try {
    // Truy vấn danh sách tên các bảng trong schema 'public'
    const result = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE';
        `);

    res.json({ success: true, tables: result.rows });
  } catch (error) {
    console.error("Database connection test failed:", error);
    res.json({ success: false, error: error.message });
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

// Quản lý người dùng
// Hiển thị danh sách người dùng
app.get("/manage_user", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM nguoi_dung ORDER BY ma_nguoi_dung ASC"
    );
    res.render("manage_user", { users: result.rows });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).send("Lỗi khi tải danh sách người dùng.");
  }
});

// Tìm kiếm người dùng
app.get("/search-user", async (req, res) => {
  const { query } = req.query;
  try {
    const result = await pool.query(
      "SELECT * FROM nguoi_dung WHERE ten_nguoi_dung ILIKE $1",
      [`%${query}%`]
    );
    // Render view với dữ liệu tìm kiếm (người dùng)
    res.render("dashboard", {
      user: req.user,
      task: "search_user",
      data: result.rows,
    });
  } catch (error) {
    console.error("Error searching users:", error);
    res.redirect("/dashboard"); // Quay lại dashboard nếu có lỗi
  }
});

// Thêm người dùng
app.get("/add-user", (req, res) => {
  res.render("add_user", { errorMessage: null });
});

app.post("/add-user", async (req, res) => {
  const { ten_nguoi_dung, email, quyen_quan_tri } = req.body;
  try {
    await pool.query(
      "INSERT INTO nguoi_dung (ten_nguoi_dung, email, quyen_quan_tri) VALUES ($1, $2, $3)",
      [ten_nguoi_dung, email, quyen_quan_tri]
    );
    res.redirect("/manage_user");
  } catch (error) {
    console.error("Error adding user:", error.message);
    res.render("add_user", {
      errorMessage: `Đã xảy ra lỗi khi thêm người dùng: ${error.message}`,
    });
  }
});

// Sửa người dùng
app.get("/edit_user/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM nguoi_dung WHERE ma_nguoi_dung = $1",
      [id]
    );
    res.render("edit_user", { user: result.rows[0] });
  } catch (error) {
    console.error("Error fetching user for edit:", error);
    res.redirect("/manage_user");
  }
});

app.post("/edit_user/:id", async (req, res) => {
  const { id } = req.params;
  const { quyen_quan_tri, trang_thai } = req.body; // Chỉ lấy quyen_quan_tri và trang_thai từ form
  try {
    // Cập nhật quyền quản trị và trạng thái người dùng
    await pool.query(
      "UPDATE nguoi_dung SET quyen_quan_tri = $1, trang_thai = $2 WHERE ma_nguoi_dung = $3",
      [quyen_quan_tri, trang_thai, id] // Truyền tham số cho câu lệnh SQL
    );
    // Quay lại trang quản lý người dùng và giữ task là "manage_user"
    res.redirect("/dashboard?task=manage_user");
  } catch (error) {
    console.error("Error updating user:", error);
    res.redirect("/dashboard?task=manage_user"); // Nếu có lỗi, quay lại trang quản lý người dùng
  }
});

// Xóa người dùng
app.post("/delete_user/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM nguoi_dung WHERE ma_nguoi_dung = $1", [id]);
    res.redirect("/dashboard?task=manage_user");
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send("Lỗi máy chủ khi xóa người dùng.");
  }
});

app.get("/dashboard", async (req, res) => {
  if (!req.isAuthenticated() || !req.user.quyen_quan_tri) {
    return res.redirect("/"); // Nếu không phải quản trị viên, chuyển hướng về trang chủ
  }

  const task = req.query.task || ""; // Nhận task từ query string
  const query = req.query.query || ""; // Lấy từ khóa tìm kiếm nếu có
  const userId = req.query.id || ""; // Lấy id người dùng cần chỉnh sửa
  let data = null;

  try {
    if (task === "manage_user") {
      // Lấy danh sách người dùng
      const result = await pool.query(
        "SELECT * FROM nguoi_dung ORDER BY ma_nguoi_dung ASC"
      );
      data = result.rows;
    } else if (task === "search_user" && query) {
      // Tìm kiếm người dùng
      const result = await pool.query(
        `SELECT * FROM nguoi_dung WHERE ten_nguoi_dung ILIKE $1 ORDER BY ma_nguoi_dung ASC`,
        [`%${query}%`]
      );
      data = result.rows;
    } else if (task === "edit_user" && userId) {
      // Lấy thông tin người dùng để chỉnh sửa
      const result = await pool.query(
        "SELECT * FROM nguoi_dung WHERE ma_nguoi_dung = $1",
        [userId]
      );
      if (result.rows.length > 0) {
        data = result.rows[0]; // Lấy thông tin người dùng cần chỉnh sửa
      } else {
        // Nếu không tìm thấy người dùng, trả về thông báo
        data = { error: "Không tìm thấy người dùng" };
      }
    } else {
      // Đặt dữ liệu mặc định nếu không có task
      const result = await pool.query(
        "SELECT * FROM nguoi_dung ORDER BY ma_nguoi_dung ASC"
      );
      data = result.rows;
    }

    // Render dashboard với thông tin user, task, và data, bao gồm cả query
    res.render("dashboard", { user: req.user, task, data, query });
  } catch (error) {
    console.error("Error loading dashboard:", error);
    res.status(500).send("Internal Server Error");
  }
});

// API: Lấy danh sách tuyen_xe
app.get("/api/routes", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tuyen_xe");
    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows });
    } else {
      res.json({ success: false, message: "Không có dữ liệu tuyến xe." });
    }
  } catch (error) {
    console.error("Error fetching routes:", error);
    res
      .status(500)
      .json({ success: false, message: "Lỗi khi tải danh sách tuyến xe." });
  }
});

app.get("/api/stations", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tram_xe");
    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows });
    } else {
      res.json({ success: false, message: "Không có dữ liệu trạm xe." });
    }
  } catch (error) {
    console.error("Error fetching routes:", error);
    res
      .status(500)
      .json({ success: false, message: "Lỗi khi tải danh sách trạm xe." });
  }
});

// Lấy dữ liệu trạm xe và tuyến xe từ PostgreSQL
app.get("/stations", async (req, res) => {
  const { query } = req.query; // Lấy tham số query từ URL
  try {
    let sqlQuery = `
      SELECT 
        tx.ma_tram_xe,
        tx.ten_tram_xe,
        tx.kinh_do,
        tx.vi_do,
        txvt.ma_tuyen_xe,
        t.ten_tuyen_xe
      FROM tram_xe tx
      LEFT JOIN tuyen_xe_va_tram_xe txvt ON tx.ma_tram_xe = txvt.ma_tram_xe
      LEFT JOIN tuyen_xe t ON txvt.ma_tuyen_xe = t.ma_tuyen_xe
    `;
    let queryParams = [];

    if (query) {
      // Tìm kiếm theo tên trạm xe
      sqlQuery += " WHERE tx.ten_tram_xe ILIKE $1"; // ILIKE giúp tìm kiếm không phân biệt chữ hoa chữ thường
      queryParams.push(`%${query.substring(0, 10)}%`);
    }

    const result = await pool.query(sqlQuery, queryParams);

    // Trả về dữ liệu dưới dạng JSON
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching stations and routes:", error);
    res
      .status(500)
      .json({ message: "Lỗi khi lấy dữ liệu trạm xe và tuyến xe." });
  }
});

//Khi người dùng nhấp vào tuyến, họ sẽ được chuyển đến trang này.
app.get("/route/:ma_tuyen_xe", async (req, res) => {
  const { ma_tuyen_xe } = req.params;
  try {
    const routeQuery = `SELECT ten_tuyen_xe FROM tuyen_xe WHERE ma_tuyen_xe = $1`;
    const routeResult = await pool.query(routeQuery, [ma_tuyen_xe]);

    if (routeResult.rows.length === 0) {
      return res.status(404).send("Không tìm thấy tuyến xe.");
    }

    const ten_tuyen_xe = routeResult.rows[0].ten_tuyen_xe;
    res.render("route", { ma_tuyen_xe, ten_tuyen_xe });
  } catch (error) {
    console.error("Error fetching route details:", error);
    res.status(500).send("Lỗi khi lấy thông tin tuyến xe.");
  }
});

// Khởi chạy server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
