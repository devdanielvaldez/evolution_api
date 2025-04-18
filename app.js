const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const { config } = require('dotenv');
const cors = require('cors');
config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
const PORT = process.env.PORT;
const CSV_FILE_PATH = 'data.csv';
const JSON_FILE_PATH = 'data.json';
const SUCCESS_REDIRECT_URL = process.env.SUCCESS_REDIRECT_URL;
const PRICES_JSON_PATH = 'prices.json';
const SUCCESS_STORIES_FILE = 'success_stories.json';

app.use(express.json());

app.use((req, res, next) => {
    if (req.originalUrl === '/webhook') {
        next();
    } else {
        express.json()(req, res, next);
    }
});

const validateIBOs = (liderIBO) => {
    return new Promise((resolve, reject) => {
        let foundLiderIBO = false;

        fs.createReadStream(CSV_FILE_PATH)
            .pipe(csv())
            .on('data', (row) => {
                if (row.LiderIBO === liderIBO) foundLiderIBO = true;
            })
            .on('end', () => {
                resolve(foundLiderIBO);
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
        const isValid = await validateIBOs(liderIBO);
        if (!isValid) {
            return res.json({ found: false });
        }

        // Cargar datos existentes
        let data = [];
        if (fs.existsSync(JSON_FILE_PATH)) {
            const fileContent = fs.readFileSync(JSON_FILE_PATH);
            data = JSON.parse(fileContent);
            
            // Contar cuántos usuarios ya tienen este numeroIBO
            const usersWithSameIBO = data.filter(user => user.numeroIBO === numeroIBO);
            if (usersWithSameIBO.length >= 2) {
                return res.status(400).json({ 
                    error: 'Validación fallida', 
                    details: 'Ya existen 2 usuarios registrados con este número de IBO. No se permiten más registros.' 
                });
            }
        }

        data.push({ 
            numeroIBO, 
            liderIBO, 
            email, 
            auspiciador: auspi, 
            isActive: false, 
            phone: phone, 
            pay: true, 
            paymentPlan: "",
            planType: "monthly",
            paymentDate: "2025-03-16T14:15:29.546Z"
        });
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

    if (email == 'gruposerulle@gmail.com' || email == 'pascualulloa@gmail.com') return res.status(200).json({ isActive: true });

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

app.get('/payment-callback', async (req, res) => {
    const { session_id, email, plan } = req.query;
    
    if (!session_id || !email || !plan) {
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
                    data[userIndex].planType = plan;
                    data[userIndex].paymentDate = new Date().toISOString();
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

app.post('/set-prices', (req, res) => {
    const { monthlyPrice, yearlyPrice } = req.body;

    if (!monthlyPrice || !yearlyPrice) {
        return res.status(400).json({ error: 'Faltan los precios mensuales o anuales' });
    }

    try {
        // Los precios deben estar en centavos para Stripe
        const prices = {
            monthly: Math.round(monthlyPrice * 100),
            yearly: Math.round(yearlyPrice * 100)
        };

        fs.writeFileSync(PRICES_JSON_PATH, JSON.stringify(prices, null, 2));
        res.json({ success: true, message: 'Precios actualizados correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar los precios', details: error.message });
    }
});

app.get('/get-prices', (req, res) => {
    try {
        if (!fs.existsSync(PRICES_JSON_PATH)) {
            return res.status(404).json({ error: 'No hay precios establecidos' });
        }

        const prices = JSON.parse(fs.readFileSync(PRICES_JSON_PATH));
        // Convertir de centavos a dólares para la respuesta
        res.json({
            monthly: prices.monthly / 100,
            yearly: prices.yearly / 100
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener los precios', details: error.message });
    }
});

app.post('/create-payment', async (req, res) => {
    const { email, plan } = req.body; // Agregar plan como parámetro (monthly o yearly)

    if (!email || !plan) {
        return res.status(400).json({ error: 'Faltan parámetros (email o plan)' });
    }

    try {
        // Verificar usuario
        if (!fs.existsSync(JSON_FILE_PATH)) {
            return res.status(404).json({ error: 'No hay datos almacenados' });
        }

        const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
        const user = data.find(item => item.email === email);

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Obtener precios
        if (!fs.existsSync(PRICES_JSON_PATH)) {
            return res.status(404).json({ error: 'No hay precios establecidos' });
        }

        const prices = JSON.parse(fs.readFileSync(PRICES_JSON_PATH));
        const amount = plan === 'monthly' ? prices.monthly : prices.yearly;
        const planName = plan === 'monthly' ? 'Mensual' : 'Anual';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `Membresía Evolution ${planName}`,
                            description: `Pago de membresía ${planName} para acceso completo`,
                        },
                        unit_amount: amount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.DOMAIN}/payment-callback?session_id={CHECKOUT_SESSION_ID}&email=${email}&plan=${plan}`,
            cancel_url: `${process.env.DOMAIN}/cancel`,
            metadata: {
                email: email,
                plan: plan
            },
        });

        res.json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
});

const readSuccessStories = () => {
    if (!fs.existsSync(SUCCESS_STORIES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SUCCESS_STORIES_FILE));
};

const writeSuccessStories = (stories) => {
    fs.writeFileSync(SUCCESS_STORIES_FILE, JSON.stringify(stories, null, 2));
};

app.post('/add-success-story', (req, res) => {
    const { title, videoUrl } = req.body;
    if (!title || !videoUrl) {
        return res.status(400).json({ error: 'Faltan parámetros' });
    }

    let stories = readSuccessStories();

    stories.push({ title, videoUrl });
    writeSuccessStories(stories);

    res.json({ success: true, message: 'Historia de éxito agregada', stories });
});

app.put('/edit-success-story/:index', (req, res) => {
    const index = parseInt(req.params.index);
    const { title, videoUrl } = req.body;

    let stories = readSuccessStories();
    if (index < 0 || index >= stories.length) {
        return res.status(404).json({ error: 'Historia de éxito no encontrada' });
    }

    if (title) stories[index].title = title;
    if (videoUrl) stories[index].videoUrl = videoUrl;
    
    writeSuccessStories(stories);
    res.json({ success: true, message: 'Historia de éxito actualizada', stories });
});

app.get('/get-success-stories', (req, res) => {
    const stories = readSuccessStories();
    res.json(stories);
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
