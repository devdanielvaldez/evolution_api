const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const { config } = require('dotenv');
const cors = require('cors');
config();

const app = express();
app.use(cors());
const PORT = process.env.PORT;
const CSV_FILE_PATH = 'data.csv';
const JSON_FILE_PATH = 'data.json';

app.use(express.json());

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

// Ruta para validar NumeroIBO y LiderIBO y almacenar datos
app.post('/validate', async (req, res) => {
    const { numeroIBO, liderIBO, email } = req.body;
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

        data.push({ numeroIBO, liderIBO, email });
        fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(data, null, 2));

        res.json({ found: true });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
});

// Ruta para buscar NumeroIBO y LiderIBO por email y devolver NombreLider
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
                res.json({ numeroIBO: entry.numeroIBO, liderIBO: entry.liderIBO, nombreLider });
            } else {
                res.status(404).json({ error: 'NombreLider no encontrado en el CSV' });
            }
        })
        .on('error', (err) => {
            res.status(500).json({ error: 'Error leyendo el archivo CSV', details: err.message });
        });
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
