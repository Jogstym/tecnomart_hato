import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import bcrypt from "bcrypt";
//import pool from "../db.js";
 
dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// ========================================
// 🔹 Conexión a PostgreSQL
// ========================================
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

// Crear carpeta de facturas si no existe
const facturasPath = "C:/Users/TECNOMART/Documents/FacturasPOS/";
if (!fs.existsSync(facturasPath)) fs.mkdirSync(facturasPath, { recursive: true });

// ========================================
// 🔹 Función para determinar turno según fecha
// ========================================
function obtenerTurno(fecha = new Date()) {
  const dia = fecha.getDay(); // 0 = Domingo
  const hora = fecha.getHours();
  const minuto = fecha.getMinutes();
  const minTotal = hora * 60 + minuto;

  // --- Lunes (1) a Jueves (4) ---
  if (dia >= 1 && dia <= 4) {
    if (minTotal >= 480 && minTotal < 960) return 1;   // 8:00 AM - 4:00 PM
    if (minTotal >= 960 && minTotal <= 1260) return 2; // 4:00 PM - 9:00 PM
  }

  // --- Viernes (5) y Sábado (6) ---
  if (dia === 5 || dia === 6) {
    if (minTotal >= 480 && minTotal <= 1200) return 1; // 8:00 AM - 8:00 PM
    return 1;
  }

  // --- Domingo (0) ---
  if (dia === 0) {
    if (minTotal >= 480 && minTotal < 900) return 2;   // 8:00 AM - 3:00 PM
    if (minTotal >= 900 && minTotal <= 1260) return 1; // 3:00 PM - 9:00 PM
  }

  return 1; // Fallback seguro
}


// ========================================
// 🔹 Probar conexión
// ========================================
app.get("/api/test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, now: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// 🔹 Buscar producto por código de barra
// ========================================
app.get("/api/productos/buscar", async (req, res) => {
  const codigo = req.query.codigo;

  if (!codigo) {
    return res.status(400).json({ error: "Debe enviar un código de barra" });
  }

  try {
    const result = await pool.query(
      `SELECT producto_id, nombre, precio, codigo_barras, stock 
       FROM productos 
       WHERE codigo_barras = $1`,
      [codigo]
    );

    if (result.rows.length === 0) return res.json({ encontrado: false });

    res.json({ encontrado: true, producto: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// 🔹 Sugerencias de servicios
// ========================================
app.get("/api/servicios/sugerencias", async (req, res) => {
  const texto = req.query.q;

  if (!texto) return res.json({ ok: true, servicios: [] });

  try {
    const result = await pool.query(
      `SELECT servicio_id, nombre, precio, precio_fijo
       FROM servicios
       WHERE estado = true
       AND LOWER(nombre) LIKE LOWER($1)
       ORDER BY nombre ASC
       LIMIT 10`,
      [`%${texto}%`]
    );

    res.json({ ok: true, servicios: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// 🔹 Obtener listado general de inventario
// ========================================
app.get("/api/inventario/productos", async (req, res) => {
  try {
    const query = `
      SELECT 
        p.producto_id,
        p.codigo_barras,
        p.nombre,
        p.descripcion,
        c.nombre AS categoria,
        p.stock,
        p.stock_minimo,
        p.precio,
        p.precio_mayor,
        p.estado,
        CASE 
          WHEN p.stock = 0 THEN 'agotado'
          WHEN p.stock <= p.stock_minimo THEN 'bajo'
          ELSE 'normal'
        END AS alerta
      FROM productos p
      LEFT JOIN categorias c ON c.categoria_id = p.categoria_id
      ORDER BY p.nombre ASC
    `;

    const result = await pool.query(query);

    res.json({ ok: true, productos: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// Historial de movimientos
// ========================================
app.get("/api/inventario/movimientos", async (req, res) => {
  const { producto_id } = req.query;

  if (!producto_id) {
    return res.status(400).json({ ok: false, error: "Debe enviar producto_id" });
  }

  try {
    const result = await pool.query(
      `SELECT 
        movimiento_id,
        tipo_movimiento,
        cantidad,
        usuario_id,
        motivo,
        fecha
       FROM inventario_movimientos
       WHERE producto_id = $1
       ORDER BY fecha DESC`,
      [producto_id]
    );

    res.json({ ok: true, movimientos: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =======================================================
// Historial de movimientos
// =======================================================
app.get("/api/inventario/movimientos", async (req, res) => {
  const { producto_id } = req.query;

  if (!producto_id) {
    return res.status(400).json({ ok: false, error: "Debe enviar producto_id" });
  }

  try {
    const result = await pool.query(
      `SELECT 
        movimiento_id,
        tipo_movimiento,
        cantidad,
        usuario_id,
        motivo,
        fecha
       FROM inventario_movimientos
       WHERE producto_id = $1
       ORDER BY fecha DESC`,
      [producto_id]
    );

    res.json({ ok: true, movimientos: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =======================================================
// Obtener alertas
// =======================================================
app.get("/api/inventario/alertas", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, p.nombre 
      FROM inventario_alertas a
      JOIN productos p ON p.producto_id = a.producto_id
      WHERE atendida = false
      ORDER BY fecha DESC
    `);

    res.json({ ok: true, alertas: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// obtener el último corte de caja
// ========================================
app.get("/api/caja/ultimo-corte-info", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         fecha_cierre,
         total_efectivo,
         total_tarjeta,
         total_transferencia,
         saldo_tigo,
         saldo_claro,
         faltante,
         venta_bruta,
         venta_neta,
         venta_efectivo
       FROM caja 
       WHERE fecha_cierre IS NOT NULL
       ORDER BY fecha_cierre DESC
       LIMIT 1`
    );

    res.json({
      ok: true,
      corte: result.rows[0] || null
    });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
// =======================================================
// Endpoint para obtener la caja actualmente abierta
// =======================================================
app.get("/api/caja/abierta", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM caja 
       WHERE estado = 'abierta'
       ORDER BY fecha_apertura DESC
       LIMIT 1`
    );

    res.json({
      ok: true,
      caja: result.rows[0] || null
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =======================================================
// CONSULTAR GASTOS POR DÍA
// =======================================================
app.get("/api/reportes/gastos", async (req, res) => {
  const dias = Number(req.query.dias) || 7;

  try {
    const result = await pool.query(
      `SELECT gasto_id, fecha, descripcion, monto, creado_en
       FROM gastos
       WHERE fecha >= CURRENT_DATE - INTERVAL '${dias} days'
       ORDER BY fecha ASC`
    );

    res.json({ ok: true, gastos: result.rows });
  } catch (error) {
    console.error("Error cargando gastos:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});
// =======================================================
// REPORTE DE TURNOS
// =======================================================
app.get("/api/reportes/turnos", async (req, res) => {
  const dias = req.query.dias || 7;

  try {
    const result = await pool.query(
      `SELECT 
         fecha_cierre::date AS fecha,
         turno,
         venta_bruta
       FROM caja
       WHERE estado = 'cerrada'
         AND fecha_cierre >= NOW() - INTERVAL '${dias} days'
       ORDER BY fecha_cierre DESC, turno ASC`
    );

    res.json({ ok: true, reportes: result.rows });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
// ========================================
// Lógica del Reporte General (backend)
// ========================================
app.get("/api/reportes/general", async (req, res) => {
  const dias = Number(req.query.dias || 30);

  try {
    const { rows } = await pool.query(
      `SELECT 
        fecha_cierre::date AS fecha,
        turno,
        venta_bruta
      FROM caja
      WHERE estado = 'cerrada'
        AND fecha_cierre >= NOW() - ($1 || ' days')::interval
      ORDER BY fecha, turno`,
      [dias]
    );

    const resumen = {};

    rows.forEach(r => {
      const fecha = r.fecha;

      if (!resumen[fecha]) {
        resumen[fecha] = {
          turno_dia: 0,
          turno_noche: 0,
          total: 0,
          meta: 1500
        };
      }

      if (r.turno === 1) {
        resumen[fecha].turno_dia += Number(r.venta_bruta);
      }

      if (r.turno === 2) {
        resumen[fecha].turno_noche += Number(r.venta_bruta);
      }

      resumen[fecha].total =
        resumen[fecha].turno_dia +
        resumen[fecha].turno_noche;
    });

    res.json({ ok: true, resumen });
  } catch (error) {
    console.error("ERROR REPORTE GENERAL:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

//------------------------------------------
app.get("/api/reportes/general/pdf", async (req, res) => {
  const dias = Number(req.query.dias || 30);

  try {
    const { rows } = await pool.query(
      `SELECT 
        fecha_cierre::date AS fecha,
        turno,
        venta_bruta
      FROM caja
      WHERE estado = 'cerrada'
        AND fecha_cierre >= NOW() - ($1 || ' days')::interval
      ORDER BY fecha, turno`,
      [dias]
    );

    // ===============================
    // AGRUPAR Y CALCULAR TOTALES
    // ===============================
    const resumen = {};
    let totalDia = 0;
    let totalNoche = 0;
    let totalGeneral = 0;

    rows.forEach(r => {
      const fecha = r.fecha;

      if (!resumen[fecha]) {
        resumen[fecha] = {
          turno_dia: 0,
          turno_noche: 0,
          total: 0,
          meta: 1500
        };
      }

      if (r.turno === 1) {
        resumen[fecha].turno_dia += Number(r.venta_bruta);
        totalDia += Number(r.venta_bruta);
      }

      if (r.turno === 2) {
        resumen[fecha].turno_noche += Number(r.venta_bruta);
        totalNoche += Number(r.venta_bruta);
      }

      resumen[fecha].total =
        resumen[fecha].turno_dia +
        resumen[fecha].turno_noche;
    });

    totalGeneral = totalDia + totalNoche;

    // ===============================
    // CREAR PDF
    // ===============================
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=reporte_general.pdf");
    doc.pipe(res);

    // ===============================
    // LOGO + TITULO
    // ===============================
    const logoPath = path.join(process.cwd(), "logos/logo.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 30, { width: 80 });
    }

    doc
      .fontSize(18)
      .text("REPORTE GENERAL DE VENTAS", 140, 40)
      .fontSize(11)
      .text(`Últimos ${dias} días`, 140, 65)
      .text(`Generado: ${new Date().toLocaleDateString("es-HN")}`, 140, 80);

    doc.moveDown(4);

    // ===============================
    // TABLA - ENCABEZADO
    // ===============================
    const startY = doc.y;
    const colX = [40, 120, 220, 320, 420, 500];

    doc.fontSize(10).font("Helvetica-Bold");
    doc.rect(40, startY, 520, 20).fill("#E5E7EB");
    doc.fillColor("black");

    const headers = ["Fecha", "Día", "Noche", "Total", "Meta", "Estado"];
    headers.forEach((h, i) => {
      doc.text(h, colX[i] + 2, startY + 5);
    });

    // ===============================
    // TABLA - FILAS
    // ===============================
    doc.font("Helvetica");
    let y = startY + 20;
    let i = 0;

    Object.entries(resumen).forEach(([fecha, r]) => {
      const bg = i % 2 === 0 ? "#FFFFFF" : "#F3F4F6";
      doc.rect(40, y, 520, 20).fill(bg);
      doc.fillColor("black");

      doc.text(new Date(fecha).toLocaleDateString("es-HN"), colX[0] + 2, y + 5);
      doc.text(`L ${r.turno_dia.toFixed(2)}`, colX[1] + 2, y + 5);
      doc.text(`L ${r.turno_noche.toFixed(2)}`, colX[2] + 2, y + 5);
      doc.text(`L ${r.total.toFixed(2)}`, colX[3] + 2, y + 5);
      doc.text(`L ${r.meta.toFixed(2)}`, colX[4] + 2, y + 5);
      doc.text(
        r.total >= r.meta ? "Cumplido" : "No cumplido",
        colX[5] + 2,
        y + 5
      );

      y += 20;
      i++;
    });

// ===============================
// RESUMEN DE TOTALES (CENTRADO)
// ===============================
const pageWidth = doc.page.width;
const boxWidth = 260;
const rowHeight = 18;

// Centro horizontal real
const boxX = (pageWidth - boxWidth) / 2;

// Debajo de la tabla
const boxY = y + 30;

// Fondo del cuadro
doc
  .rect(boxX, boxY, boxWidth, rowHeight * 5)
  .fill("#F3F4F6");

doc.fillColor("black");

// Título
doc
  .font("Helvetica-Bold")
  .fontSize(11)
  .text("RESUMEN DE TOTALES", boxX + 10, boxY + 6);

// Línea separadora
doc
  .moveTo(boxX + 10, boxY + 22)
  .lineTo(boxX + boxWidth - 10, boxY + 22)
  .stroke();

// Contenido
doc.font("Helvetica").fontSize(10);

let ry = boxY + 28;

doc.text("Total Turno Día:", boxX + 10, ry);
doc.text(`L ${totalDia.toFixed(2)}`, boxX + boxWidth - 10, ry, {
  align: "right",
  width: 90
});
ry += rowHeight;

doc.text("Total Turno Noche:", boxX + 10, ry);
doc.text(`L ${totalNoche.toFixed(2)}`, boxX + boxWidth - 10, ry, {
  align: "right",
  width: 90
});
ry += rowHeight;

// Línea separadora
doc
  .moveTo(boxX + 10, ry)
  .lineTo(boxX + boxWidth - 10, ry)
  .stroke();
ry += 6;

// Total general destacado
doc.font("Helvetica-Bold");

doc.text("TOTAL GENERAL:", boxX + 10, ry);
doc.text(`L ${totalGeneral.toFixed(2)}`, boxX + boxWidth - 10, ry, {
  align: "right",
  width: 90
});
doc.end();

  } catch (error) {
    console.error("ERROR PDF:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// LISTAR USUARIOS (solo admin)
// ========================================
app.get(
  "/api/usuarios",
  validarSesion,
  requierePermiso("usuarios.gestionar"),
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          usuario_id,
          nombre,
          usuario,
          rol,
          activo
        FROM usuarios
        ORDER BY usuario_id
      `);

      res.json({
        ok: true,
        usuarios: result.rows,
      });
    } catch (error) {
      console.error("ERROR LISTAR USUARIOS:", error);
      res.status(500).json({
        ok: false,
        error: "Error al obtener usuarios",
      });
    }
  }
);


//-----------
//permisos usuarios
app.get(
  "/api/usuarios/permisos",
  validarSesion,
  async (req, res) => {
    const usuarioId = req.usuario.usuario_id;

    const { rows } = await pool.query(
      `
      SELECT p.nombre
      FROM usuario_permisos up
      JOIN permisos p ON p.permiso_id = up.permiso_id
      WHERE up.usuario_id = $1
      `,
      [usuarioId]
    );

    res.json({
      ok: true,
      permisos: rows.map(p => p.nombre)
    });
  }
);

//------permisos de un usuario
app.get("/api/permisos", validarSesion, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT nombre FROM permisos ORDER BY nombre"
  );
  res.json({ permisos: rows });
});

//permisos de un usuario especifico
app.get(
  "/api/usuarios/:id/permisos",
  validarSesion,
  requierePermiso("usuarios.gestionar"),
  async (req, res) => {
    const { id } = req.params;

    const { rows } = await pool.query(`
      SELECT p.nombre
      FROM usuario_permisos up
      JOIN permisos p ON p.permiso_id = up.permiso_id
      WHERE up.usuario_id = $1
    `, [id]);

    res.json({
      ok: true,
      permisos: rows.map(p => p.nombre)
    });
  }
);

// --- Listar clientes con credito 
app.get("/api/clientes/credito", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cliente_id, nombre, telefono, monto_deuda, fecha_credito
      FROM clientes
      WHERE tiene_credito = true
      ORDER BY fecha_credito DESC
    `);

    res.json({ ok: true, clientes: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =======================================================
// Marcar alerta como atendida
// =======================================================
app.patch("/api/inventario/alertas/:id/atender", async (req, res) => {
  try {
    await pool.query(
      `UPDATE inventario_alertas 
       SET atendida = true 
       WHERE alerta_id = $1`,
      [req.params.id]
    );

    res.json({ ok: true, mensaje: "Alerta marcada como atendida" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

//---------utilidades previas al pdf
function numeroALetras(num) {
  const unidades = [
    "", "UNO", "DOS", "TRES", "CUATRO", "CINCO",
    "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ",
    "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE",
    "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"
  ];

  const decenas = [
    "", "", "VEINTE", "TREINTA", "CUARENTA",
    "CINCUENTA", "SESENTA", "SETENTA",
    "OCHENTA", "NOVENTA"
  ];

  function convertir(n) {
    if (n < 20) return unidades[n];
    if (n < 100) {
      const d = Math.floor(n / 10);
      const r = n % 10;
      return r === 0 ? decenas[d] : `${decenas[d]} Y ${unidades[r]}`;
    }
    if (n === 100) return "CIEN";
    if (n < 200) return `CIENTO ${convertir(n - 100)}`;
    return n.toString(); // fallback seguro
  }

  const entero = Math.floor(num);
  const centavos = Math.round((num - entero) * 100);

  return `${convertir(entero)} LEMPIRAS CON ${centavos
    .toString()
    .padStart(2, "0")}/100`;
}

// =======================================================
// 🔥 REGISTRAR VENTA + DETALLES + GENERAR FACTURA PDF
// =======================================================
app.post("/api/ventas/registrar", async (req, res) => {
  try {
    const {
      items,
      total,
      clienteNombre,
      clienteRTN,
      usuarioNombre,
       metodoPago,
    } = req.body;

    const fecha = new Date();
    const { usuarioId } = req.body; 

    const ventaResult = await pool.query(
      `INSERT INTO ventas (usuario_id, fecha, metodo_pago, total, total_final, estado)
      VALUES ($1, NOW(), $2, $3, $3, 'completada')
      RETURNING numero_factura`,
      [usuarioId, metodoPago, total]
    );
    const numero_factura = ventaResult.rows[0].numero_factura;

      // ===============================
      // 🔻 DESCONTAR INVENTARIO POR VENTA
      // ===============================
      for (const item of items) {

        // Ignorar servicios
        if (typeof item.producto_id === "string" && item.producto_id.startsWith("S")) { continue;}

        // Registrar salida (MISMA lógica que inventario/salida)
        await pool.query(
          `INSERT INTO inventario_movimientos 
            (producto_id, tipo_movimiento, cantidad, usuario_id, motivo, fecha)
          VALUES ($1,'SALIDA',$2,$3,'Venta',NOW())`,
          [item.producto_id, item.cantidad, usuarioId]
        );

        await pool.query(
          `INSERT INTO inventario_log 
            (producto_id, usuario_id, tipo_movimiento, cantidad, detalle, fecha)
          VALUES ($1,$2,'SALIDA',$3,'Venta POS',NOW())`,
          [item.producto_id, usuarioId, item.cantidad]
        );

        const stockResult = await pool.query(
          `UPDATE productos 
          SET stock = stock - $1 
          WHERE producto_id = $2
          RETURNING stock, stock_minimo, nombre`,
          [item.cantidad, item.producto_id]
        );

        const { stock, stock_minimo, nombre } = stockResult.rows[0];

        if (stock <= stock_minimo) {
          const mensaje =
            stock === 0
              ? `Producto agotado: ${nombre}`
              : `Stock bajo en ${nombre}. Stock actual: ${stock}`;

          await pool.query(
            `INSERT INTO inventario_alertas
              (producto_id, stock_actual, mensaje, fecha, atendida)
            VALUES ($1,$2,$3,NOW(),false)`,
            [item.producto_id, stock, mensaje]
          );
        }
      }

    // ---------- Altura dinámica real ----------
    const ALTURA_HEADER = 160;
    const ALTURA_FILA = 14;
    const ALTURA_TOTALES = 90;
    const ALTURA_QR = 120;
    const ALTURA_FOOTER = 40;

    const docHeight =
      ALTURA_HEADER +
      items.length * ALTURA_FILA +
      ALTURA_TOTALES +
      ALTURA_QR +
      ALTURA_FOOTER;

    const fileName = `${numero_factura}.pdf`;
    const filePath = path.join(facturasPath, fileName);

    const doc = new PDFDocument({
      margin: 10,
      size: [300, docHeight]
    });

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // ================= LOGO (CENTRADO) =================
    try {
      doc.image("./logos/logo.png", (300 - 70) / 2, 10, { width: 70 });
    } catch {}

    doc.y = 90; // reserva real para evitar montado

    // ================= ENCABEZADO =================
    doc.font("Helvetica-Bold").fontSize(10).text("TECNOMART", { align: "center" });
    doc.font("Helvetica").fontSize(8)
      .text("Tecnología avanzada en Informática", { align: "center" })
      .text("Ubicados en la Col. Hato de Enmedio - Plazita - Sector #6 ", { align: "center" })
      .text("Edificio 2do nivel - frente a SUPERCARNES", { align: "center" })
      .text("Tel: 9841-1640 • tecnomart67@gmail.com", { align: "center" });

    doc.moveDown(0.5);
    doc.moveTo(10, doc.y).lineTo(290, doc.y).stroke();

    // ================= DATOS CLIENTE =================
    const clienteFinal = clienteNombre?.trim() ? clienteNombre : "CONSUMIDOR FINAL";

    doc.moveDown(0.5).fontSize(8); 
    doc.text(`CLIENTE: ${clienteFinal}`);
    doc.text(`RTN: ${clienteRTN || ""}`);
    doc.text(`FECHA: ${fecha.toLocaleDateString()}`);
    doc.text(`HORA: ${fecha.toLocaleTimeString()}`);
    doc.text(`FACTURA: ${numero_factura}`);
    doc.text(`VENDEDOR: ${usuarioNombre}`);

    doc.moveDown(0.5);
    doc.moveTo(10, doc.y).lineTo(290, doc.y).stroke();

    // ================= TABLA =================
    doc.font("Helvetica-Bold").fontSize(8);

    const yHeader = doc.y+5;

    doc.text("CANT", 10, yHeader);
    doc.text("DESCRIPCIÓN", 45, yHeader);
    doc.text("TOTAL", 220, yHeader, { align: "right" });

    doc.y = yHeader + 12;
    doc.moveTo(10, doc.y).lineTo(290, doc.y).stroke();

    let y = doc.y + 4;
    doc.font("Helvetica").fontSize(8);

    items.forEach(item => {
      doc.text(item.cantidad.toString(), 10, y);
      doc.text(item.nombre, 45, y, { width: 170 });
      const totalLinea = item.precio * item.cantidad;
      doc.text(`L. ${totalLinea.toFixed(2)}`, 230, y, {width: 50,align: "right"});
      y += ALTURA_FILA;
    });

    doc.moveTo(10, y).lineTo(290, y).stroke();
    y += 10;

    // ================= TOTALES =================
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text(`TOTAL A PAGAR: L. ${total.toFixed(2)}`, 10, y);
    y += 15;

    doc.font("Helvetica").fontSize(8);
    doc.text(`SON: ${numeroALetras(total)}`, 10, y, { width: 280 });
    y += 30;

    // ================= QR (IMAGEN FIJA) =================
    try {
      doc.image("./logos/qr.png", (300 - 80) / 2, y, { width: 80 });
    } catch {}

    y += 90;

    // ================= FOOTER =================
    doc.fontSize(7).text("La factura es beneficio de todos. ¡EXÍJALA!", 10, y, { align: "center" });
    y += 12;
    doc.fontSize(8).text("¡GRACIAS POR SU COMPRA!", { align: "center" });

    doc.end();

    writeStream.on("finish", () => {
      res.json({ ok: true, mensaje: "Venta registrada y factura generada", archivo: fileName });
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});


// =======================================================
// Crear nuevo producto
// =======================================================
app.post("/api/inventario/productos", async (req, res) => {
  const {
    codigo_barras,
    nombre,
    descripcion,
    categoria_id,
    stock,
    stock_minimo,
    precio,
    precio_mayor
  } = req.body;

  if (!codigo_barras || !nombre || !precio) {
    return res.status(400).json({ ok: false, error: "Datos incompletos" });
  }

  try {
    await pool.query("BEGIN");

    const result = await pool.query(
      `INSERT INTO productos 
        (codigo_barras, nombre, descripcion, categoria_id, stock, stock_minimo, precio, precio_mayor, estado, fecha_creacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW())
       RETURNING producto_id`,
      [
        codigo_barras,
        nombre,
        descripcion || "",
        categoria_id || null,
        stock || 0,
        stock_minimo || 0,
        precio,
        precio_mayor || 0
      ]
    );

    const producto_id = result.rows[0].producto_id;

    // Registrar movimiento inicial si tiene stock
    if (stock > 0) {
      await pool.query(
        `INSERT INTO inventario_movimientos 
          (producto_id, tipo_movimiento, cantidad, usuario_id, motivo, fecha)
         VALUES ($1,'ENTRADA',$2,1,'Ingreso inicial',NOW())`,
        [producto_id, stock]
      );
    }

    await pool.query("COMMIT");

    res.json({ ok: true, mensaje: "Producto creado correctamente" });

  } catch (error) {
    await pool.query("ROLLBACK");
    res.status(500).json({ ok: false, error: error.message });
  }
});


// =======================================================
// Registrar ENTRADA de inventario
// =======================================================
app.post("/api/inventario/entrada", async (req, res) => {
  const { producto_id, cantidad, motivo, usuario_id } = req.body;

  if (!producto_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ ok: false, error: "Datos inválidos" });
  }

  try {
    await pool.query("BEGIN");

    // Registrar movimiento
    await pool.query(
      `INSERT INTO inventario_movimientos (producto_id, tipo_movimiento, cantidad, usuario_id, motivo, fecha)
       VALUES ($1,'ENTRADA',$2,$3,$4,NOW())`,
      [producto_id, cantidad, usuario_id, motivo]
    );

    // Log
    await pool.query(
      `INSERT INTO inventario_log (producto_id, usuario_id, tipo_movimiento, cantidad, detalle, fecha)
       VALUES ($1,$2,'ENTRADA',$3,$4,NOW())`,
      [producto_id, usuario_id, cantidad, motivo]
    );

    // Actualizar stock
    const stockResult = await pool.query(
      `UPDATE productos 
       SET stock = stock + $1 
       WHERE producto_id = $2 
       RETURNING stock, stock_minimo`,
      [cantidad, producto_id]
    );

    const { stock, stock_minimo } = stockResult.rows[0];

    // Si el stock ya está normal → limpiar alertas antiguas
    if (stock > stock_minimo) {
      await pool.query(
        `UPDATE inventario_alertas 
         SET atendida = true 
         WHERE producto_id = $1 AND atendida = false`,
        [producto_id]
      );
    }

    await pool.query("COMMIT");

    res.json({ ok: true, mensaje: "Entrada registrada correctamente" });

  } catch (error) {
    await pool.query("ROLLBACK");
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// Registrar SALIDA de inventario
// ========================================
app.post("/api/inventario/salida", async (req, res) => {
  const { producto_id, cantidad, motivo, usuario_id } = req.body;

  if (!producto_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ ok: false, error: "Datos inválidos" });
  }

  try {
    await pool.query("BEGIN");

    // Registrar movimiento
    await pool.query(
      `INSERT INTO inventario_movimientos (producto_id, tipo_movimiento, cantidad, usuario_id, motivo, fecha)
       VALUES ($1,'SALIDA',$2,$3,$4,NOW())`,
      [producto_id, cantidad, usuario_id, motivo]
    );

    // Registrar log
    await pool.query(
      `INSERT INTO inventario_log (producto_id, usuario_id, tipo_movimiento, cantidad, detalle, fecha)
       VALUES ($1,$2,'SALIDA',$3,$4,NOW())`,
      [producto_id, usuario_id, cantidad, motivo]
    );

    // Actualizar stock
    const stockResult = await pool.query(
      `UPDATE productos 
       SET stock = stock - $1 
       WHERE producto_id = $2 
       RETURNING stock, stock_minimo, nombre`,
      [cantidad, producto_id]
    );

    const { stock, stock_minimo, nombre } = stockResult.rows[0];

    // Crear alerta si stock bajo
    if (stock <= stock_minimo) {
      const mensaje = stock === 0
        ? `Producto agotado: ${nombre}`
        : `Stock bajo en ${nombre}. Stock actual: ${stock}`;

      await pool.query(
        `INSERT INTO inventario_alertas (producto_id, stock_actual, mensaje, fecha, atendida)
         VALUES ($1,$2,$3,NOW(),false)`,
        [producto_id, stock, mensaje]
      );
    }

    await pool.query("COMMIT");

    res.json({ ok: true, mensaje: "Salida registrada correctamente" });

  } catch (error) {
    await pool.query("ROLLBACK");
    res.status(500).json({ ok: false, error: error.message });
  }
});
app.patch("/api/inventario/precio/:id", async (req, res) => {
  const { precio, precio_mayor } = req.body;

  if (!precio || precio < 0) {
    return res.status(400).json({ ok: false, error: "Precio inválido" });
  }

  try {
    await pool.query(
      `UPDATE productos 
       SET precio = $1, precio_mayor = $2
       WHERE producto_id = $3`,
      [precio, precio_mayor || 0, req.params.id]
    );

    res.json({ ok: true, mensaje: "Precio actualizado correctamente" });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

//------Editar nombre y codigo de barras-------
app.patch("/api/inventario/productos/:id", async (req, res) => {
  const { codigo_barras, nombre } = req.body;

  if (!codigo_barras || !nombre) {
    return res.status(400).json({
      ok: false,
      error: "Código de barras y nombre son obligatorios"
    });
  }

  try {
    // Validar código único
    const existe = await pool.query(
      `SELECT producto_id FROM productos 
       WHERE codigo_barras = $1 AND producto_id <> $2`,
      [codigo_barras, req.params.id]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "El código de barras ya está en uso"
      });
    }

    await pool.query(
      `UPDATE productos 
       SET codigo_barras = $1, nombre = $2
       WHERE producto_id = $3`,
      [codigo_barras, nombre, req.params.id]
    );

    res.json({
      ok: true,
      mensaje: "Producto actualizado correctamente"
    });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// 🔥 Registrar un NUEVO arqueo de caja
// ========================================
app.post("/api/caja/cerrar", async (req, res) => {
  const {
    total_efectivo,
    total_tarjeta,
    total_transferencia,
    saldo_tigo,
    saldo_claro,
    faltante
  } = req.body;

  try {
    const abierta = await pool.query(
      `SELECT * FROM caja WHERE estado = 'abierta'
       ORDER BY fecha_apertura DESC LIMIT 1`
    );

    if (abierta.rows.length === 0) {
      return res.status(400).json({ ok: false, error: "No hay caja abierta." });
    }

    const CORTE_BASE = 5000;
    const cajaId = abierta.rows[0].caja_id;

    const totalCaja =
      Number(total_efectivo) +
      Number(saldo_tigo) +
      Number(saldo_claro);

    const venta_bruta =
      (totalCaja - CORTE_BASE) + total_transferencia+total_tarjeta;

    const turno = obtenerTurno(new Date());

    await pool.query(
      `UPDATE caja SET 
        total_efectivo = $1,
        total_tarjeta = $2,
        total_transferencia = $3,
        saldo_tigo = $4,
        saldo_claro = $5,
        faltante = $6,
        venta_bruta = $7,
        turno = $8,
        fecha_cierre = NOW(),
        estado = 'cerrada'
       WHERE caja_id = $9`,
      [
        total_efectivo,
        total_tarjeta,
        total_transferencia,
        saldo_tigo,
        saldo_claro,
        faltante,
        venta_bruta,
        turno,
        cajaId
      ]
    );

    res.json({ ok: true, mensaje: "Corte de caja guardado correctamente." });

  } catch (error) {
    console.error("ERROR CIERRE CAJA:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// Endpoint para ABRIR una nueva caja
// ========================================
app.post("/api/caja/abrir", async (req, res) => {
  const usuario_id = req.body.usuario_id || 1;   // Usa 1 como usuario por defecto
  const fondo_inicial = Number(req.body.fondo_inicial) || 0;

  try {
    await pool.query("UPDATE caja SET estado='cerrada' WHERE estado='abierta'");

    const result = await pool.query(
      `INSERT INTO caja (usuario_apertura, fecha_apertura, fondo_inicial, estado)
       VALUES ($1, NOW(), $2, 'abierta')
       RETURNING caja_id`,
      [usuario_id, fondo_inicial]
    );

    res.json({
      ok: true,
      mensaje: "Caja abierta correctamente.",
      caja_id: result.rows[0].caja_id
    });

  } catch (error) {
    console.error("ERROR al abrir caja:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// Registrar un gasto diario
// ========================================
app.post("/api/reportes/gastos", async (req, res) => {
  const { descripcion, monto } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO gastos (descripcion, monto)
       VALUES ($1, $2)
       RETURNING *`,
      [descripcion, monto]
    );

    res.json({ ok: true, gasto: result.rows[0] });

  } catch (error) {
    console.error("Error guardando gasto:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});


// ========================================
// LOGIN
// ========================================
app.post("/api/login", async (req, res) => {
  const { usuario, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT * FROM usuarios 
       WHERE usuario = $1 AND activo = true 
       LIMIT 1`,
      [usuario]
    );

    if (result.rows.length === 0) {
      return res.json({ ok: false, error: "Usuario no encontrado o inactivo" });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.json({ ok: false, error: "Contraseña incorrecta" });
    }

    const token = Buffer.from(
      `${user.usuario_id}:${Date.now()}`
    ).toString("base64");

    res.json({
      ok: true,
      token,
      usuario: {
        usuario_id: user.usuario_id,
        nombre: user.nombre,
        rol: user.rol
      }
    });

  } catch (error) {
    console.error("ERROR LOGIN:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// Endpoint para asignar permisos a un usuario
// ========================================
app.post("/api/usuarios/asignar-permisos", validarSesion, requierePermiso("usuarios.gestionar"), async (req, res) => {
  const { usuario_id, permisos } = req.body;

  await pool.query("DELETE FROM usuario_permisos WHERE usuario_id = $1", [usuario_id]);

  for (const permiso of permisos) {
    await pool.query(
      "INSERT INTO usuario_permisos (usuario_id, permiso_id) VALUES ($1, (SELECT permiso_id FROM permisos WHERE nombre = $2))",
      [usuario_id, permiso]
    );
  }

  res.json({ ok: true, mensaje: "Permisos actualizados" });
});
// ========================================
// Crear usuario (solo admin con permiso usuarios.gestionar)
// ========================================
app.post("/api/usuarios/crear", validarSesion, requierePermiso("usuarios.gestionar"), async (req, res) => {
  const { nombre, usuario, password, rol } = req.body;

  const password_hash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO usuarios (nombre, usuario, password_hash, rol)
     VALUES ($1, $2, $3, $4)`,
    [nombre, usuario, password_hash, rol]
  );

  res.json({ ok: true, mensaje: "Usuario creado" });
});

//---- Insertar clientes con credito
app.post("/api/clientes/credito", async (req, res) => {
  const { nombre, telefono, monto } = req.body;

  try {
    await pool.query(`
      INSERT INTO clientes (nombre, telefono, tiene_credito, monto_deuda, fecha_credito)
      VALUES ($1, $2, true, $3, NOW())
    `, [nombre, telefono, monto]);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========================================
// 🔥 Editar un gasto
// ========================================
app.put("/api/gastos/editar/:id", async (req, res) => {
  const { descripcion, monto } = req.body;

  try {
    await pool.query(
      `UPDATE gastos SET descripcion = $1, monto = $2 WHERE gasto_id = $3`,
      [descripcion, monto, req.params.id]
    );

    res.json({ ok: true, mensaje: "Gasto actualizado" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

//------------desactivar usuarios
app.put(
  "/api/usuarios/:id/activo",
  validarSesion,
  requierePermiso("usuarios.gestionar"),
  async (req, res) => {
    const { activo } = req.body;

    await pool.query(
      "UPDATE usuarios SET activo = $1 WHERE usuario_id = $2",
      [activo, req.params.id]
    );

    res.json({ ok: true });
  }
);

// ---- asignar credito / crear deuda
app.put("/api/clientes/:id/credito", async (req, res) => {
  const { monto } = req.body;
  const { id } = req.params;

  try {
    await pool.query(`
      UPDATE clientes
      SET tiene_credito = true,
          monto_deuda = $1,
          fecha_credito = NOW()
      WHERE cliente_id = $2
    `, [monto, id]);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

//----- aumentar o dismunuir deuda
app.put("/api/clientes/:id/deuda", async (req, res) => {
  const { monto } = req.body; // puede ser + o -
  const { id } = req.params;

  try {
    await pool.query(`
      UPDATE clientes
      SET monto_deuda = monto_deuda + $1
      WHERE cliente_id = $2
    `, [monto, id]);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

//---- quitar credito
app.put("/api/clientes/:id/quitar-credito", async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(`
      UPDATE clientes
      SET tiene_credito = false,
          monto_deuda = 0,
          fecha_credito = NULL
      WHERE cliente_id = $1
    `, [id]);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/gastos/eliminar/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM gastos WHERE gasto_id = $1`, [
      req.params.id,
    ]);

    res.json({ ok: true, mensaje: "Gasto eliminado" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

//------Eliminar productos de la base para siempre
app.delete("/api/inventario/productos/:id", async (req, res) => {
  const producto_id = req.params.id;

  try {
    await pool.query("BEGIN");

    // Verificar si el producto tiene ventas
    const ventas = await pool.query(
      `SELECT 1 FROM ventas_detalles 
       WHERE descripcion = (
         SELECT nombre FROM productos WHERE producto_id = $1
       )
       LIMIT 1`,
      [producto_id]
    );

    if (ventas.rows.length > 0) {
      await pool.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "No se puede eliminar un producto con ventas registradas"
      });
    }

    // Eliminar dependencias
    await pool.query(`DELETE FROM inventario_movimientos WHERE producto_id = $1`, [producto_id]);
    await pool.query(`DELETE FROM inventario_alertas WHERE producto_id = $1`, [producto_id]);
    await pool.query(`DELETE FROM inventario_log WHERE producto_id = $1`, [producto_id]);

    // Eliminar producto
    await pool.query(`DELETE FROM productos WHERE producto_id = $1`, [producto_id]);

    await pool.query("COMMIT");

    res.json({
      ok: true,
      mensaje: "Producto eliminado definitivamente"
    });

  } catch (error) {
    await pool.query("ROLLBACK");
    res.status(500).json({ ok: false, error: error.message });
  }
});

//--eliminar usuario
app.delete(
  "/api/usuarios/:id",
  validarSesion,
  requierePermiso("usuarios.gestionar"),
  async (req, res) => {
    const { id } = req.params;

    await pool.query("DELETE FROM usuario_permisos WHERE usuario_id = $1", [id]);
    await pool.query("DELETE FROM usuarios WHERE usuario_id = $1", [id]);

    res.json({ ok: true, mensaje: "Usuario eliminado" });
  }
);

// ========================================
// Middleware para validar si el usuario está activo
// ========================================
export function validarSesion(req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: "No autenticado"
    });
  }

  try {
    // Tu token es base64: "usuario_id:timestamp"
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const [usuario_id] = decoded.split(":");

    req.usuario = { usuario_id: Number(usuario_id) };
    next();

  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: "Token inválido"
    });
  }
}
// ========================================
// Middleware para validar permisos
// ========================================
function requierePermiso(nombrePermiso) {
  return async (req, res, next) => {
    const userId = req.usuario.usuario_id;

    const query = `
      SELECT p.nombre 
      FROM usuario_permisos up
      JOIN permisos p ON p.permiso_id = up.permiso_id
      WHERE up.usuario_id = $1
    `;

    const result = await pool.query(query, [userId]);

    const lista = result.rows.map(r => r.nombre);

    if (!lista.includes(nombrePermiso)) {
      return res.status(403).json({
        ok: false,
        error: "No autorizado"
      });
    }

    next();
  };
}

// ========================================
// 🔥 Iniciar servidor
// ========================================
app.listen(process.env.PORT, () => {
  console.log(`Servidor backend corriendo en http://localhost:${process.env.PORT}`);
});
