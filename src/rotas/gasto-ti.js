const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

const checkPermission = verifyToken.requireModulePermission('gasto-ti');

const COL_GASTOS = 'ti_gastos';
const COL_LANCAMENTOS = 'ti_gastos_lancamentos';

const TIPOS_VALIDOS = ['mensal', 'unico', 'outros'];

function validarTexto(v, max = 150) {
    return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
}

function normalizarTexto(v) {
    return (v || '').toString().trim();
}

function normalizarData(v) {
    const s = normalizarTexto(v);
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined; // formato inválido
    return s;
}

// undefined = inválido, null = vazio (não informado), número = ok
function normalizarDiaVencimento(v) {
    if (v === undefined || v === null || v === '') return null;
    const dia = Number(v);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) return undefined;
    return dia;
}

// null = não informado (inválido aqui), true/false = ok
function normalizarBooleano(v) {
    if (v === undefined || v === null || v === '') return null;
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
    return null;
}

// Data local (não UTC) — o "dia de vencimento" é um conceito de calendário
// local (todo dia 5, por exemplo); usar toISOString() aqui erraria o dia
// perto da virada da meia-noite (Brasil é UTC-3).
function hojeLocal() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// O sistema não é quem paga essas contas — ele só guarda prova do que foi
// gasto todo mês. Por isso, uma conta mensal de valor FIXO (ex.: VPS que
// sempre custa R$31) não espera ninguém clicar em nada: assim que o dia de
// vencimento chega, replica sozinha o valor de referência como lançamento
// do mês. Só contas de valor VARIÁVEL (ex.: Firebase, que muda com o uso)
// ficam em branco aguardando lançamento manual.
async function sincronizarMensalidadesFixas() {
    const hoje = hojeLocal();
    const mesAtual = hoje.slice(0, 7);
    const diaHoje = Number(hoje.slice(8, 10));

    const fixasSnap = await db.collection(COL_GASTOS)
        .where('tipo', '==', 'mensal')
        .where('valorFixo', '==', true)
        .get();
    if (fixasSnap.empty) return;

    const pendentes = fixasSnap.docs.filter(doc => {
        const g = doc.data();
        return g.diaVencimento && diaHoje >= g.diaVencimento;
    });
    if (!pendentes.length) return;

    for (const doc of pendentes) {
        const gastoRef = doc.ref;
        const lancamentoRef = db.collection(COL_LANCAMENTOS).doc();
        try {
            await db.runTransaction(async (tx) => {
                const jaLancadoSnap = await tx.get(
                    db.collection(COL_LANCAMENTOS)
                        .where('gastoId', '==', doc.id)
                        .where('data', '>=', `${mesAtual}-01`)
                        .limit(1)
                );
                if (!jaLancadoSnap.empty) return; // corrida evitada — já foi lançado

                const gastoSnap = await tx.get(gastoRef);
                if (!gastoSnap.exists) return;
                const gasto = gastoSnap.data();

                tx.set(lancamentoRef, {
                    gastoId: doc.id,
                    valor: gasto.valor,
                    data: hoje,
                    observacoes: 'Lançamento automático (valor fixo, repete o valor de referência)',
                    automatico: true,
                    createdAt: new Date().toISOString(),
                    createdBy: null
                });
                tx.update(gastoRef, { valorTotal: (gasto.valorTotal || 0) + gasto.valor });
            });
        } catch (err) {
            // best-effort — a sincronização automática nunca pode derrubar a listagem
        }
    }
}

// ==========================================
// GASTOS DE T.I. — itens de despesa recorrente ou única do setor
// (assinaturas, licenças, VPS, compras avulsas...), usados só como prova
// do que se gasta — quem efetivamente paga é a instituição, não o sistema.
// `valor` é o valor de referência. `valorTotal` soma todos os lançamentos
// feitos sobre o item e fica denormalizado no doc (mesmo padrão do módulo
// Orçamento).
//
// Vencimento tem dois formatos, dependendo do tipo:
// - "mensal": `diaVencimento` (1 a 31) — dia fixo do mês em que a conta
//   recorre, pra sempre (ex.: "todo dia 5"). Junto vem `valorFixo`:
//   true = replica sozinho o valor de referência quando o dia chega;
//   false = fica em branco aguardando alguém lançar o valor real do mês.
// - "unico"/"outros": `vencimento` — data única (AAAA-MM-DD).
// Um gasto nunca tem os dois formatos preenchidos ao mesmo tempo.
// ==========================================
router.get('/itens', verifyToken, checkPermission, async (req, res) => {
    try {
        await sincronizarMensalidadesFixas();

        const { tipo } = req.query;
        const snap = await db.collection(COL_GASTOS).orderBy('createdAt', 'desc').get();
        let gastos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Pra cada gasto mensal, informa se já teve lançamento neste mês
        // (usado pelo front pra saber se já está coberto ou se falta lançar).
        const mesAtual = hojeLocal().slice(0, 7);
        const lancSnap = await db.collection(COL_LANCAMENTOS).where('data', '>=', `${mesAtual}-01`).get();
        const lancadosEsteMes = new Set();
        lancSnap.forEach(doc => lancadosEsteMes.add(doc.data().gastoId));
        gastos = gastos.map(g => g.tipo === 'mensal' ? { ...g, pagoEsteMes: lancadosEsteMes.has(g.id) } : g);

        if (tipo && tipo !== 'todos') gastos = gastos.filter(g => g.tipo === tipo);
        res.json(gastos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Contagem de gastos "pendentes" — usada pelo círculo vermelho no menu
// lateral. Só sobra pendência de verdade pra conta mensal de valor
// VARIÁVEL sem lançamento este mês (fixo já foi auto-lançado acima) ou pra
// único/outros com a data de vencimento já passada.
router.get('/itens/alertas', verifyToken, checkPermission, async (req, res) => {
    try {
        await sincronizarMensalidadesFixas();

        const hoje = hojeLocal();
        const mesAtual = hoje.slice(0, 7);
        const diaHoje = Number(hoje.slice(8, 10));

        const gastosSnap = await db.collection(COL_GASTOS).get();
        const temMensal = gastosSnap.docs.some(doc => doc.data().tipo === 'mensal' && doc.data().diaVencimento);

        let lancadosEsteMes = new Set();
        if (temMensal) {
            const lancSnap = await db.collection(COL_LANCAMENTOS).where('data', '>=', `${mesAtual}-01`).get();
            lancSnap.forEach(doc => lancadosEsteMes.add(doc.data().gastoId));
        }

        let total = 0;
        gastosSnap.docs.forEach(doc => {
            const g = doc.data();
            if (g.tipo === 'mensal' && g.diaVencimento) {
                if (g.valorFixo) return; // valor fixo já é auto-lançado, nunca fica pendente
                if (diaHoje >= g.diaVencimento && !lancadosEsteMes.has(doc.id)) total++;
            } else if (g.vencimento && g.vencimento <= hoje) {
                total++;
            }
        });

        res.json({ total });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/itens', verifyToken, checkPermission, async (req, res) => {
    try {
        const nome = normalizarTexto(req.body.nome);
        const descricao = normalizarTexto(req.body.descricao);
        const tipo = normalizarTexto(req.body.tipo);
        const valor = Number(req.body.valor);

        if (!validarTexto(nome)) return res.status(400).json({ error: 'Informe um nome para o gasto.' });
        if (!TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido. Use mensal, único ou outros.' });
        if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ error: 'Informe um valor válido, maior que zero.' });

        let diaVencimento = null;
        let vencimento = null;
        let valorFixo = null;
        if (tipo === 'mensal') {
            diaVencimento = normalizarDiaVencimento(req.body.diaVencimento);
            if (diaVencimento === undefined) return res.status(400).json({ error: 'Informe um dia de vencimento válido, entre 1 e 31.' });
            if (!diaVencimento) return res.status(400).json({ error: 'Informe o dia de vencimento (1 a 31).' });

            valorFixo = normalizarBooleano(req.body.valorFixo);
            if (valorFixo === null) return res.status(400).json({ error: 'Informe se o valor dessa conta é fixo ou variável.' });
        } else {
            vencimento = normalizarData(req.body.vencimento);
            if (vencimento === undefined) return res.status(400).json({ error: 'Data de vencimento inválida.' });
        }

        const docRef = await db.collection(COL_GASTOS).add({
            nome,
            descricao: descricao || null,
            tipo,
            valor,
            valorTotal: 0,
            diaVencimento,
            vencimento,
            valorFixo,
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid
        });
        res.status(201).json({ id: docRef.id, message: 'Gasto cadastrado com sucesso.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/itens/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const ref = db.collection(COL_GASTOS).doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Gasto não encontrado.' });
        const atual = snap.data();

        const update = {};

        if (req.body.nome !== undefined) {
            const nome = normalizarTexto(req.body.nome);
            if (!validarTexto(nome)) return res.status(400).json({ error: 'Informe um nome válido.' });
            update.nome = nome;
        }
        if (req.body.descricao !== undefined) update.descricao = normalizarTexto(req.body.descricao) || null;
        if (req.body.valor !== undefined) {
            const valor = Number(req.body.valor);
            if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ error: 'Informe um valor válido, maior que zero.' });
            update.valor = valor;
        }

        let tipoFinal = atual.tipo;
        if (req.body.tipo !== undefined) {
            const tipo = normalizarTexto(req.body.tipo);
            if (!TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido. Use mensal, único ou outros.' });
            update.tipo = tipo;
            tipoFinal = tipo;
        }

        // Vencimento/dia de vencimento/valorFixo seguem o tipo final: ao trocar
        // de tipo, os campos do formato antigo são zerados pra não sobrar lixo
        // inconsistente.
        if (tipoFinal === 'mensal') {
            if (req.body.diaVencimento !== undefined || req.body.tipo !== undefined) {
                const base = req.body.diaVencimento !== undefined ? req.body.diaVencimento : atual.diaVencimento;
                const diaVencimento = normalizarDiaVencimento(base);
                if (!diaVencimento) return res.status(400).json({ error: 'Informe o dia de vencimento (1 a 31).' });
                update.diaVencimento = diaVencimento;
            }
            if (req.body.valorFixo !== undefined || req.body.tipo !== undefined) {
                const base = req.body.valorFixo !== undefined ? req.body.valorFixo : atual.valorFixo;
                const valorFixo = normalizarBooleano(base);
                if (valorFixo === null) return res.status(400).json({ error: 'Informe se o valor dessa conta é fixo ou variável.' });
                update.valorFixo = valorFixo;
            }
            if (req.body.tipo !== undefined) update.vencimento = null;
        } else {
            if (req.body.vencimento !== undefined || req.body.tipo !== undefined) {
                const base = req.body.vencimento !== undefined ? req.body.vencimento : atual.vencimento;
                const vencimento = normalizarData(base);
                if (vencimento === undefined) return res.status(400).json({ error: 'Data de vencimento inválida.' });
                update.vencimento = vencimento;
            }
            if (req.body.tipo !== undefined) {
                update.diaVencimento = null;
                update.valorFixo = null;
            }
        }

        await ref.update(update);
        res.json({ message: 'Gasto atualizado.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/itens/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const ref = db.collection(COL_GASTOS).doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Gasto não encontrado.' });

        const lancSnap = await db.collection(COL_LANCAMENTOS).where('gastoId', '==', req.params.id).get();
        const batch = db.batch();
        lancSnap.forEach(doc => batch.delete(doc.ref));
        batch.delete(ref);
        await batch.commit();

        res.json({ message: 'Gasto excluído.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// LANÇAMENTOS — prova do que foi gasto num determinado mês com um gasto
// (ex.: fatura do Firebase daquele mês, ou a mensalidade do VPS). Não é um
// registro de pagamento (quem paga é a instituição, não o sistema) — só um
// valor e uma observação opcional; a data é sempre a de quando foi
// registrado aqui, não algo que se escolhe. `valorTotal` do gasto é
// recalculado numa transação a cada lançamento criado/removido.
// ==========================================
router.get('/itens/:id/lancamentos', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection(COL_LANCAMENTOS).where('gastoId', '==', req.params.id).get();
        const lancamentos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
        res.json(lancamentos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/itens/:id/lancamentos', verifyToken, checkPermission, async (req, res) => {
    try {
        const gastoId = req.params.id;
        const valor = Number(req.body.valor);
        const observacoes = normalizarTexto(req.body.observacoes);

        // Aceita 0 (ex.: mês sem cobrança, franquia grátis) — só não aceita negativo.
        if (!Number.isFinite(valor) || valor < 0) return res.status(400).json({ error: 'Informe um valor válido (0 ou maior).' });

        const gastoRef = db.collection(COL_GASTOS).doc(gastoId);
        const lancamentoRef = db.collection(COL_LANCAMENTOS).doc();

        await db.runTransaction(async (tx) => {
            const gastoSnap = await tx.get(gastoRef);
            if (!gastoSnap.exists) throw new Error('Gasto não encontrado.');
            const gasto = gastoSnap.data();

            tx.set(lancamentoRef, {
                gastoId, valor,
                data: hojeLocal(),
                observacoes: observacoes || null,
                automatico: false,
                createdAt: new Date().toISOString(),
                createdBy: req.user.uid
            });

            tx.update(gastoRef, { valorTotal: (gasto.valorTotal || 0) + valor });
        });

        res.status(201).json({ id: lancamentoRef.id, message: 'Valor lançado com sucesso.' });
    } catch (err) {
        res.status(err.message === 'Gasto não encontrado.' ? 404 : 500).json({ error: err.message });
    }
});

router.delete('/lancamentos/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const lancamentoRef = db.collection(COL_LANCAMENTOS).doc(req.params.id);

        await db.runTransaction(async (tx) => {
            const lancSnap = await tx.get(lancamentoRef);
            if (!lancSnap.exists) throw new Error('Lançamento não encontrado.');
            const lanc = lancSnap.data();

            const gastoRef = db.collection(COL_GASTOS).doc(lanc.gastoId);
            const gastoSnap = await tx.get(gastoRef);
            if (gastoSnap.exists) {
                const gasto = gastoSnap.data();
                const novoTotal = Math.max(0, (gasto.valorTotal || 0) - (lanc.valor || 0));
                tx.update(gastoRef, { valorTotal: novoTotal });
            }
            tx.delete(lancamentoRef);
        });

        res.json({ message: 'Lançamento removido.' });
    } catch (err) {
        res.status(err.message.includes('não encontrado') ? 404 : 500).json({ error: err.message });
    }
});

module.exports = router;
