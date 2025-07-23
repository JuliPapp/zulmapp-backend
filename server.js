const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de menú (igual que en Apps Script)
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
  'Ensalada completa',
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

// Función para verificar horarios (igual que Apps Script)
const checkTimeRestriction = (userEmail) => {
  const adminEmail = "juliandanielpappalettera@gmail.com";
  
  // Si es admin, siempre tiene acceso
  if (userEmail === adminEmail) {
    return { allowed: true, isAdmin: true };
  }
  
  const now = new Date();
  // Convertir a horario de Argentina
  const argTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Argentina/Buenos_Aires"}));
  
  const dayOfWeek = argTime.getDay(); // 0=domingo, 1=lunes, ..., 6=sábado
  const hour = argTime.getHours();
  const minute = argTime.getMinutes();
  
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5; // Lunes a viernes
  const isInTimeRange = (hour === 7 || hour === 8 || hour === 9) || 
                       (hour === 10 && minute <= 15); // 7:00 a 10:15
  
  return { allowed: isWeekday && isInTimeRange, isAdmin: false };
};

// Función para calcular números de platos
const calculateDishNumbers = async (userEmail) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Obtener todos los pedidos del día ordenados por timestamp
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('fecha', today)
      .order('timestamp', { ascending: true });

    if (error) throw error;

    const allDishes = [];
    
    // Procesar todos los pedidos para obtener orden cronológico
    pedidos.forEach(pedido => {
      // Agregar cada plato del pedido a la lista general
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
        message: 'La app solo está disponible de lunes a viernes de 7:00 a 10:15 AM'
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

    const today = new Date().toISOString().split('T')[0];
    
    // Verificar si ya existe un pedido del usuario hoy
    const { data: existingOrder } = await supabase
      .from('pedidos')
      .select('*')
      .eq('email', userEmail)
      .eq('fecha', today)
      .single();

    const orderData = {
      nombre: nombre.trim(),
      email: userEmail,
      usuario: userEmail.split('@')[0],
      plato1: plato1 || '',
      plato2: plato2 || '',
      plato3: plato3 || '',
      fecha: today,
      timestamp: new Date().toISOString()
    };

    let result;
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

    let message = action === 'updated' ? 'Pedido actualizado correctamente' : 'Pedido registrado correctamente';
    
    if (dishNumbers.length > 0) {
      if (dishNumbers.length === 1) {
        message += `. Tu plato es el número ${dishNumbers[0]}`;
      } else {
        message += `. Tus platos son los números ${dishNumbers.join(', ')}`;
      }
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
    const today = new Date().toISOString().split('T')[0];

    const { data: order, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('email', userEmail)
      .eq('fecha', today)
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

// Obtener estadísticas del día
app.get('/api/stats', verifyAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('fecha', today)
      .order('timestamp', { ascending: true });

    if (error) throw error;

    const stats = {
      totalOrders: pedidos.length,
      menuStats: {},
      peopleList: []
    };

    // Procesar estadísticas
    pedidos.forEach(pedido => {
      // Agregar persona a la lista
      stats.peopleList.push({
        nombre: pedido.nombre,
        usuario: pedido.usuario,
        timestamp: pedido.timestamp
      });

      // Contar platos
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
    const today = new Date().toISOString().split('T')[0];

    // Verificar horarios
    const timeCheck = checkTimeRestriction(userEmail);
    if (!timeCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: 'La app solo está disponible de lunes a viernes de 7:00 a 10:15 AM'
      });
    }

    const { error } = await supabase
      .from('pedidos')
      .delete()
      .eq('email', userEmail)
      .eq('fecha', today);

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
