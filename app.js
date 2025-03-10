const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const { config } = require('dotenv');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
config();

const app = express();
app.use(cors());
const PORT = process.env.PORT;
const CSV_FILE_PATH = 'data.csv';
const JSON_FILE_PATH = 'data.json';
const SUCCESS_REDIRECT_URL = process.env.SUCCESS_REDIRECT_URL || 'https://example.com/success';

app.use(express.json());

app.use((req, res, next) => {
    if (req.originalUrl === '/webhook') {
      next();
    } else {
      express.json()(req, res, next);
    }
  });

const validateIBOs = (numeroIBO, liderIBO) => {
    return new Promise((resolve, reject) => {
        let foundNumeroIBO = false;
        let foundLiderIBO = false;

        fs.createReadStream(CSV_FILE_PATH)
            .pipe(csv())
            .on('data', (row) => {
                if (row.NumeroIBO === numeroIBO) foundNumeroIBO = true;
                if (row.LiderIBO === liderIBO) foundLiderIBO = true;
            })
            .on('end', () => {
                resolve(foundNumeroIBO && foundLiderIBO);
            })
            .on('error', (err) => reject(err));
    });
};

app.post('/validate', async (req, res) => {
    const { numeroIBO, liderIBO, email, auspi, phone } = req.body;
    if (!numeroIBO || !liderIBO || !email) {
        return res.status(400).json({ error: 'Faltan parámetros' });
    }

    try {
        const isValid = await validateIBOs(numeroIBO, liderIBO);
        if (!isValid) {
            return res.json({ found: false });
        }

        let data = [];
        if (fs.existsSync(JSON_FILE_PATH)) {
            const fileContent = fs.readFileSync(JSON_FILE_PATH);
            data = JSON.parse(fileContent);
        }

        data.push({ numeroIBO, liderIBO, email, auspiciador: auspi, isActive: false, phone: phone, pay: false });
        fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(data, null, 2));

        res.json({ found: true });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
});

app.get('/get-info/:email', (req, res) => {
    const email = req.params.email;
    if (!fs.existsSync(JSON_FILE_PATH)) {
        return res.status(404).json({ error: 'No hay datos almacenados' });
    }

    const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
    const entry = data.find(item => item.email === email);
    if (!entry) {
        return res.status(404).json({ error: 'Email no encontrado' });
    }

    let nombreLider = null;
    fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv())
        .on('data', (row) => {
            if (row.NumeroIBO === entry.numeroIBO && row.LiderIBO === entry.liderIBO) {
                nombreLider = row.NombreLider;
            }
        })
        .on('end', () => {
            if (nombreLider) {
                res.json({ numeroIBO: entry.numeroIBO, liderIBO: entry.liderIBO, nombreLider, auspiciador: entry.auspiciador });
            } else {
                res.status(404).json({ error: 'NombreLider no encontrado en el CSV' });
            }
        })
        .on('error', (err) => {
            res.status(500).json({ error: 'Error leyendo el archivo CSV', details: err.message });
        });
});

app.post('/activate', (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Falta el parámetro email' });
    }

    if (!fs.existsSync(JSON_FILE_PATH)) {
        return res.status(404).json({ error: 'No hay datos almacenados' });
    }

    try {
        const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
        const userIndex = data.findIndex(item => item.email === email);
        
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Actualizar el estado del usuario a activo
        data[userIndex].isActive = true;
        fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(data, null, 2));

        res.json({ success: true, message: 'Usuario activado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
});

app.get('/is-active/:email', (req, res) => {
    const email = req.params.email;

    if(email == 'gruposerulle@gmail.com') return res.status(200).json({ isActive: true });
    
    if (!fs.existsSync(JSON_FILE_PATH)) {
        return res.status(404).json({ error: 'No hay datos almacenados' });
    }

    try {
        const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
        const user = data.find(item => item.email === email);
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ isActive: user.isActive });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
});

app.post('/create-payment', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Falta el parámetro email' });
    }
    
    try {
      if (!fs.existsSync(JSON_FILE_PATH)) {
        return res.status(404).json({ error: 'No hay datos almacenados' });
      }
      
      const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
      const user = data.find(item => item.email === email);
      
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Membresía Evolution',
                description: 'Pago de membresía para acceso completo',
              },
              unit_amount: 2000,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${process.env.DOMAIN}/payment-callback?session_id={CHECKOUT_SESSION_ID}&email=${email}`,
        cancel_url: `${process.env.DOMAIN}/cancel`,
        metadata: {
          email: email,
        },
      });
      
      res.json({ url: session.url });
    } catch (error) {
      res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
  });

  app.get('/payment-callback', async (req, res) => {
    const { session_id, email } = req.query;
    
    if (!session_id || !email) {
      return res.status(400).json({ error: 'Parámetros insuficientes' });
    }
    
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      
      if (session.payment_status === 'paid') {
        if (fs.existsSync(JSON_FILE_PATH)) {
          const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
          const userIndex = data.findIndex(item => item.email === email);
          
          if (userIndex !== -1) {
            data[userIndex].pay = true;
            fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(data, null, 2));
            
            return res.redirect(SUCCESS_REDIRECT_URL);
          }
        }
      }
      
      res.status(400).json({ error: 'No se pudo verificar el pago o actualizar el usuario' });
    } catch (error) {
      res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
  });
  
  app.get('/is-paid/:email', (req, res) => {
    const email = req.params.email;
      
    if (!fs.existsSync(JSON_FILE_PATH)) {
      return res.status(404).json({ error: 'No hay datos almacenados' });
    }
  
    try {
      const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
      const user = data.find(item => item.email === email);
      
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
  
      res.json({ paid: user.pay });
    } catch (error) {
      res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
  });

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});