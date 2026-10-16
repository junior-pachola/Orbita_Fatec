const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// Economia de leitura (mesmo padrão do cache de cargo/permissões em
// middlewares/auth.js): cada abertura da tela, o polling de 2 min e o
// recarregamento depois de devolver/cadastrar liam a coleção INTEIRA de novo
// (~50 documentos por vez). Agora a lista fica em memória por alguns minutos
// e as escritas (PUT/DELETE) atualizam o cache no lugar, sem reler o banco.
// O prazo existe porque na Vercel pode haver mais de uma instância: uma
// escrita feita em outra instância aparece aqui em no máximo CACHE_TTL.
const CACHE_TTL = 2 * 60 * 1000; // 2 minutos (mesmo intervalo do polling da tela)
let cacheLista = { dados: null, lidoEm: 0 };

const ordenarPorId = (lista) => lista.sort((a, b) => a.id.localeCompare(b.id));

async function lerLista(forcarFresh = false) {
    if (!forcarFresh && cacheLista.dados && (Date.now() - cacheLista.lidoEm) < CACHE_TTL) {
        return cacheLista.dados;
    }
    const snapshot = await db.collection('notebooks').get();
    const lista = [];
    snapshot.forEach(doc => lista.push({ id: doc.id, ...doc.data() }));
    cacheLista = { dados: ordenarPorId(lista), lidoEm: Date.now() };
    return cacheLista.dados;
}

// Aplica no cache o mesmo merge que foi gravado no Firestore (set com merge)
function atualizarNoCache(id, dados) {
    if (!cacheLista.dados) return;
    const i = cacheLista.dados.findIndex(n => n.id === id);
    if (i >= 0) {
        cacheLista.dados[i] = { ...cacheLista.dados[i], ...dados, id };
    } else {
        cacheLista.dados.push({ ...dados, id });
        ordenarPorId(cacheLista.dados);
    }
}

function removerDoCache(id) {
    if (!cacheLista.dados) return;
    cacheLista.dados = cacheLista.dados.filter(n => n.id !== id);
}

// GET /api/emprestimos - Retorna todos os notebooks
// ?fresh=1 ignora o cache em memória — usado pela tela logo depois de uma
// escrita (devolver/cadastrar/etc), porque na Vercel o PUT pode ter sido
// atendido por uma instância serverless diferente da que atende este GET;
// cada instância tem seu próprio cache, então sem isso a tela podia mostrar
// o item como se nada tivesse mudado até o cache dessa instância expirar.
router.get('/', verifyToken, verifyToken.requireModulePermission('emprestimo'), async (req, res) => {
    try {
        res.json(await lerLista(req.query.fresh === '1'));
    } catch (error) {
        console.error('Erro ao buscar empréstimos:', error);
        res.status(500).json({ error: 'Erro ao buscar dados.' });
    }
});

// GET /api/emprestimos/:id - Retorna um notebook específico
router.get('/:id', verifyToken, verifyToken.requireModulePermission('emprestimo'), async (req, res) => {
    try {
        // Com o cache ainda válido, responde sem ler o banco (polling da tela Movimentar)
        if (cacheLista.dados && (Date.now() - cacheLista.lidoEm) < CACHE_TTL) {
            const doCache = cacheLista.dados.find(n => n.id === req.params.id);
            if (doCache) return res.json(doCache);
        }
        const docRef = await db.collection('notebooks').doc(req.params.id).get();
        if (!docRef.exists) {
            return res.status(404).json({ error: 'Equipamento não encontrado.' });
        }
        res.json({ id: docRef.id, ...docRef.data() });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar equipamento.' });
    }
});

// PUT /api/emprestimos/:id - Atualiza ou cria o registro
router.put('/:id', verifyToken, verifyToken.requireModulePermission('emprestimo'), async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        
        // Remove o ID do payload para não duplicar dados dentro do documento
        if (data.id) delete data.id;
        
        const docRef = db.collection('notebooks').doc(id);
        const docSnap = await docRef.get();
        let historico = [];
        
        if (docSnap.exists) {
            const oldData = docSnap.data();
            if (oldData.historico && Array.isArray(oldData.historico)) {
                historico = oldData.historico;
            }
            
            // Registra um evento no historico
            const evento = {
                status: data.status || oldData.status,
                updatedAt: data.updatedAt || new Date().toISOString(),
                responsavel: data.responsavel || oldData.responsavel || 'Desconhecido',
                observacao: data.observacao || '',
                local: data.local || oldData.local || '',
                sala: data.sala || oldData.sala || '',
                funcionario: data.funcionario || oldData.funcionario || '',
                setor: data.setor || oldData.setor || '',
                requerente: data.requerente || oldData.requerente || ''
            };
            
            historico.unshift(evento);
            historico = historico.slice(0, 4); // Manter as 4 ultimas
            data.historico = historico;
        } else {
            // Documento novo (cadastro)
            const evento = {
                status: data.status,
                updatedAt: data.updatedAt || new Date().toISOString(),
                responsavel: data.responsavel || 'Desconhecido',
                observacao: data.observacao || '',
                local: data.local || '',
                sala: data.sala || '',
                funcionario: data.funcionario || '',
                setor: data.setor || '',
                requerente: data.requerente || ''
            };
            historico.unshift(evento);
            data.historico = historico;
        }

        await docRef.set(data, { merge: true });
        atualizarNoCache(id, data);
        res.json({ status: 'success', message: `Equipamento ${id} atualizado.` });
    } catch (error) {
        console.error('Erro ao atualizar empréstimo:', error);
        res.status(500).json({ error: 'Erro ao atualizar dados.' });
    }
});

// DELETE /api/emprestimos/:id - Exclui o item do banco de dados (para itens temporários)
router.delete('/:id', verifyToken, verifyToken.requireModulePermission('emprestimo'), async (req, res) => {
    try {
        const id = req.params.id;
        await db.collection('notebooks').doc(id).delete();
        removerDoCache(id);
        res.json({ status: 'success', message: `Equipamento ${id} excluído com sucesso.` });
    } catch (error) {
        console.error('Erro ao excluir empréstimo:', error);
        res.status(500).json({ error: 'Erro ao excluir dados.' });
    }
});

module.exports = router;
