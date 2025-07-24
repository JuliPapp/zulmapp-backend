const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de menú
const MENU_ITEMS = [
  'Tarta - jamón y queso',
  'Tarta - capresse',
  'Tarta - brócoli',
  'Tarta - zapallito',
  'Tarta - pollo',
  'Tarta - calabaza',
  'Tortilla de papa',
  'Pastel de papa',
  'Ensalada César',
  'Ensalada Completa',
  'Fideos con bolognesa',
  'Fideos con salsa de tomate',
];

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Middleware para verificar auth
const verifyAuth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token requerido' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ success: false, message: 'Token inválido' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Error de autenticación' });
  }
};

// Lista de administradores (puede configurarse por variable de entorno ADMIN_EMAILS, separada por comas)
const ADMIN_EMAILS = process.env.ADMIN_EMAILS
  ? process.env.ADMIN_EMAILS.split(',').map((e) => e.trim())
  : [
      'juliandanielpappalettera@gmail.com',
      'leandro.binetti@gmail.com',
      'alanpablomarino@gmail.com',
    ];

/**
 * Obtiene la hora actual en Buenos Aires.
 */
const getArgTime = () => {
  const now = new Date();
  return new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
  );
};

/**
 * Calcula la "fecha de ciclo".  Si la hora es ≥14:00, pertenece al día siguiente; de lo contrario, al día actual.
 */
const getCycleDate = (argTime) => {
  const hour = argTime.getHours();
  if (hour >= 14) {
    const tomorrow = new Date(argTime);
    tomorrow.setDate(argTime.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  return argTime.toISOString().split('T')[0];
};

/**
 * Verifica si las operaciones están permitidas según el horario y día de la semana.
 * Permite pedidos de lunes a viernes desde las 14:00 hasta las 10:15 del día siguiente.
 * Los administradores siempre tienen acceso.
 */
const checkTimeRestriction = (userEmail) => {
  // Administradores siempre tienen acceso
  if (ADMIN_EMAILS.includes(userEmail)) {
    return { allowed: true, isAdmin: true };
  }
  const argTime = getArgTime();
  const dayOfWeek = argTime.getDay();
  const hour = argTime.getHours();
  const minute = argTime.getMinutes();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5; // lunes a viernes
  // Permitir si la hora es >=14:00 o <=10:15
  const isInTimeRange =
    hour >= 14 || hour < 10 || (hour === 10 && minute <= 15);
  return { allowed: isWeekday && isInTimeRange, isAdmin: false };
};

// Función para calcular números de platos
const calculateDishNumbers = async (userEmail) => {
  try {
    // Calcular la fecha del ciclo actual
    const argTime = getArgTime();
    const cycleDate = getCycleDate(argTime);
    // Obtener todos los pedidos del ciclo ordenados por timestamp
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('fecha', cycleDate)
      .order('timestamp', { ascending: true });

    if (error) throw error;

    const allDishes = [];
    // Procesar todos los pedidos para obtener orden cronológico
    pedidos.forEach(pedido => {
      [pedido.plato1, pedido.plato2, pedido.plato3].forEach(plato => {
        if (plato && plato.trim() !== '') {
          allDishes.push({
            plato: plato.trim(),
            email: pedido.email,
            timestamp: pedido.timestamp
          });
        }
      });
    });

    // Encontrar los números de los platos del usuario específico
    const dishNumbers = [];
    allDishes.forEach((dish, index) => {
      if (dish.email === userEmail) {
        dishNumbers.push(index + 1);
      }
    });

    return dishNumbers;
  } catch (error) {
    console.error('Error calculando números de platos:', error);
    return [];
  }
};

// RUTAS DE LA API

// Obtener menú
app.get('/api/menu', (req, res) => {
  res.json({ success: true, menuItems: MENU_ITEMS });
});

// Crear/actualizar pedido
app.post('/api/pedidos', verifyAuth, async (req, res) => {
  try {
    const { nombre, plato1, plato2, plato3 } = req.body;
    const userEmail = req.user.email;

    // Verificar horarios
    const timeCheck = checkTimeRestriction(userEmail);
    if (!timeCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: 'La app solo está disponible de lunes a viernes de 14:00 a 10:15'
      });
    }

    // Validar datos
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Por favor ingresa tu nombre'
      });
    }

    if (!plato1) {
      return res.status(400).json({
        success: false,
        message: 'Por favor selecciona al menos el plato principal'
      });
    }

    // Calcular fecha de ciclo
    const argTime = getArgTime();
    const cycleDate = getCycleDate(argTime);

    // Verificar si ya existe un pedido del usuario en este ciclo
    const { data: existingOrder } = await supabase
      .from('pedidos')
      .select('*')
      .eq('email', userEmail)
      .eq('fecha', cycleDate)
      .single();

    const orderData = {
      nombre: nombre.trim(),
      email: userEmail,
      usuario: userEmail.split('@')[0],
      plato1: plato1 || '',
      plato2: plato2 || '',
      plato3: plato3 || '',
      fecha: cycleDate,
      timestamp: getArgTime().toISOString(), // ✅ CORREGIDO: Usa timezone de Argentina
    };

    let action;
    if (existingOrder) {
      // Actualizar pedido existente
      const { error } = await supabase
        .from('pedidos')
        .update(orderData)
        .eq('id', existingOrder.id);
      if (error) throw error;
      action = 'updated';
    } else {
      // Crear nuevo pedido
      const { error } = await supabase
        .from('pedidos')
        .insert([orderData]);
      if (error) throw error;
      action = 'created';
    }

    // Calcular números de platos
    const dishNumbers = await calculateDishNumbers(userEmail);

    let message = action === 'updated'
      ? 'Pedido actualizado correctamente'
      : 'Pedido registrado correctamente';
    
    if (dishNumbers.length > 0) {
      message += dishNumbers.length === 1
        ? `. Tu plato es el número ${dishNumbers[0]}`
        : `. Tus platos son los números ${dishNumbers.join(', ')}`;
    }

    res.json({
      success: true,
      message,
      action,
      dishNumbers,
      totalPlatos: dishNumbers.length
    });

  } catch (error) {
    console.error('Error procesando pedido:', error);
    res.status(500).json({
      success: false,
      message: 'Error al procesar el pedido: ' + error.message
    });
  }
});

// Obtener pedido actual del usuario
app.get('/api/pedidos/current', verifyAuth, async (req, res) => {
  try {
    const userEmail = req.user.email;
    // Fecha de ciclo
    const argTime = getArgTime();
    const cycleDate = getCycleDate(argTime);

    const { data: order, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('email', userEmail)
      .eq('fecha', cycleDate)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (order) {
      const dishNumbers = await calculateDishNumbers(userEmail);
      res.json({
        success: true,
        order: {
          nombre: order.nombre,
          plato1: order.plato1,
          plato2: order.plato2,
          plato3: order.plato3,
          dishNumbers
        }
      });
    } else {
      res.json({ success: true, order: null });
    }
  } catch (error) {
    console.error('Error obteniendo pedido actual:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener pedido: ' + error.message
    });
  }
});

// Obtener estadísticas del ciclo
app.get('/api/stats', verifyAuth, async (req, res) => {
  try {
    // Fecha de ciclo
    const argTime = getArgTime();
    const cycleDate = getCycleDate(argTime);

    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('fecha', cycleDate)
      .order('timestamp', { ascending: true });

    if (error) throw error;

    const stats = {
      totalOrders: pedidos.length,
      menuStats: {},
      peopleList: []
    };

    // Procesar estadísticas
    pedidos.forEach(pedido => {
      // ✅ CORREGIDO: Incluir platos en peopleList
      stats.peopleList.push({
        nombre: pedido.nombre,
        usuario: pedido.usuario,
        timestamp: pedido.timestamp,
        plato1: pedido.plato1,
        plato2: pedido.plato2,
        plato3: pedido.plato3
      });

      [pedido.plato1, pedido.plato2, pedido.plato3].forEach(plato => {
        if (plato && plato.trim() !== '') {
          stats.menuStats[plato] = (stats.menuStats[plato] || 0) + 1;
        }
      });
    });

    res.json({ success: true, stats });

  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas: ' + error.message,
      stats: { totalOrders: 0, menuStats: {}, peopleList: [] }
    });
  }
});

// Cancelar pedido
app.delete('/api/pedidos/current', verifyAuth, async (req, res) => {
  try {
    const userEmail = req.user.email;
    // Fecha de ciclo
    const argTime = getArgTime();
    const cycleDate = getCycleDate(argTime);

    // Verificar horarios
    const timeCheck = checkTimeRestriction(userEmail);
    if (!timeCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: 'La app solo está disponible de lunes a viernes de 14:00 a 10:15'
      });
    }

    const { error } = await supabase
      .from('pedidos')
      .delete()
      .eq('email', userEmail)
      .eq('fecha', cycleDate);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Pedido cancelado correctamente'
    });

  } catch (error) {
    console.error('Error cancelando pedido:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cancelar el pedido: ' + error.message
    });
  }
});

// Ruta de health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Backend funcionando correctamente' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📱 Zulmapp Backend v2.0 - Migrado desde Apps Script`);
});
