import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
    Wallet,
    Store,
    Calendar,
    Clock,
    CheckCircle2,
    AlertCircle,
    Copy,
    Edit2,
    Trash2,
    X,
    Save,
    LogOut,
    TrendingUp,
    AlertTriangle,
    Plus,
    RefreshCw,
    ToggleLeft,
    ToggleRight
} from 'lucide-react'
import { format, parseISO, getDaysInMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { motion, AnimatePresence } from 'framer-motion'

const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
)

const DAILY_GOAL = 70000 // Meta diaria SHURIAN en pesos

export default function App() {
    // --- Auth ---
    const [session, setSession] = useState(null)
    const [authLoading, setAuthLoading] = useState(true)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [isRegistering, setIsRegistering] = useState(false)
    const [authError, setAuthError] = useState(null)
    const [connectionWarning, setConnectionWarning] = useState(false)

    // --- Expenses ---
    const [expenses, setExpenses] = useState([])
    const [filter, setFilter] = useState('ALL')
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState(null)
    const [isCreating, setIsCreating] = useState(false)
    const [editForm, setEditForm] = useState({})
    const [newExpense, setNewExpense] = useState({
        entity: '', amount: '', due_date: format(new Date(), 'yyyy-MM-dd'),
        category: 'Personal', payment_code: '', status: 'pending'
    })

    // --- Subscriptions ---
    const [subscriptions, setSubscriptions] = useState([])
    const [showSubs, setShowSubs] = useState(false)
    const [newSub, setNewSub] = useState({
        entity: '', category: 'Personal', amount: '', due_day: 1, payment_code: ''
    })

    // --- Auth Effects ---
    useEffect(() => {
        // Alerta de lentitud si Supabase tarda más de 5 segundos en responder (por ejemplo, si está pausado)
        const timer = setTimeout(() => {
            setConnectionWarning(true)
        }, 5000)

        supabase.auth.getSession()
            .then(({ data: { session } }) => {
                clearTimeout(timer)
                setSession(session)
                setAuthLoading(false)
            })
            .catch(err => {
                clearTimeout(timer)
                console.error("Error al obtener sesión de Supabase:", err)
                setAuthError(err.message || "Error al conectar con el servidor.")
                setAuthLoading(false)
            })

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
            setSession(s)
            setAuthLoading(false) // Aseguramos desactivar el loader al cambiar de estado de autenticación
        })

        return () => {
            clearTimeout(timer)
            subscription.unsubscribe()
        }
    }, [])

    useEffect(() => {
        if (session) {
            fetchExpenses()
            fetchSubscriptions()
            const sub = supabase.channel('expenses-ch')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, fetchExpenses)
                .subscribe()
            return () => supabase.removeChannel(sub)
        }
    }, [session])

    const handleLogin = async (e) => {
        e.preventDefault()
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) alert('Error: ' + error.message)
    }
    const handleSignUp = async (e) => {
        e.preventDefault()
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) alert('Error: ' + error.message)
        else alert('¡Revisá tu mail para confirmar el registro!')
    }
    const handleLogout = () => supabase.auth.signOut()

    // --- Expenses CRUD ---
    const fetchExpenses = async () => {
        setLoading(true)
        try {
            const { data, error } = await supabase.from('expenses').select('*').order('due_date', { ascending: true })
            if (error) throw error
            setExpenses(data || [])
        } catch (err) {
            console.error("Error al cargar los gastos:", err)
        } finally {
            setLoading(false)
        }
    }

    const markAsPaid = async (id) => {
        await supabase.from('expenses').update({ status: 'paid' }).eq('id', id)
    }

    const startEditing = (expense) => { setEditingId(expense.id); setEditForm({ ...expense }) }

    const saveEdit = async () => {
        const { error } = await supabase.from('expenses').update({
            entity: editForm.entity, amount: parseFloat(editForm.amount),
            due_date: editForm.due_date, payment_code: editForm.payment_code
        }).eq('id', editingId)
        if (!error) { setEditingId(null); fetchExpenses() }
    }

    const deleteExpense = async (id) => {
        if (!confirm('¿Eliminar este gasto?')) return
        await supabase.from('expenses').delete().eq('id', id)
    }

    const createExpense = async () => {
        if (!newExpense.entity || !newExpense.amount) return alert('Completá entidad y monto')
        await supabase.from('expenses').insert([{
            ...newExpense, user_id: session.user.id, amount: parseFloat(newExpense.amount)
        }])
        setIsCreating(false)
        setNewExpense({ entity: '', amount: '', due_date: format(new Date(), 'yyyy-MM-dd'), category: 'Personal', payment_code: '', status: 'pending' })
    }

    const copyToClipboard = (text) => navigator.clipboard.writeText(text)

    // --- Subscriptions CRUD ---
    const fetchSubscriptions = async () => {
        try {
            const { data, error } = await supabase.from('subscriptions').select('*').order('due_day', { ascending: true })
            if (error) throw error
            setSubscriptions(data || [])
        } catch (err) {
            console.error("Error al cargar las suscripciones:", err)
        }
    }

    const createSubscription = async () => {
        if (!newSub.entity || !newSub.amount) return alert('Completá entidad y monto')
        await supabase.from('subscriptions').insert([{
            ...newSub, user_id: session.user.id, amount: parseFloat(newSub.amount), due_day: parseInt(newSub.due_day)
        }])
        setNewSub({ entity: '', category: 'Personal', amount: '', due_day: 1, payment_code: '' })
        fetchSubscriptions()
    }

    const toggleSubscription = async (sub) => {
        await supabase.from('subscriptions').update({ is_active: !sub.is_active }).eq('id', sub.id)
        fetchSubscriptions()
    }

    const deleteSubscription = async (id) => {
        if (!confirm('¿Eliminar esta suscripción?')) return
        await supabase.from('subscriptions').delete().eq('id', id)
        fetchSubscriptions()
    }

    // --- Calculations ---
    const filteredExpenses = expenses.filter(e => filter === 'ALL' || e.category === filter)

    // Totales de gastos PENDIENTES por categoría (para el widget de deudas)
    const pendingTotals = expenses.reduce((acc, e) => {
        if (e.status !== 'pending') return acc
        if (e.category === 'Personal') acc.personal += e.amount
        else acc.shurian += e.amount
        return acc
    }, { personal: 0, shurian: 0 })

    // Termómetro SHURIAN
    const monthlyGoal = DAILY_GOAL * 20
    const shurianPendingCost = pendingTotals.shurian
    const progressPct = Math.min((shurianPendingCost / monthlyGoal) * 100, 100)
    const progressColor = progressPct < 40 ? '#22c55e' : progressPct < 70 ? '#f59e0b' : '#ef4444'

    const nextDue = expenses.find(e => e.status === 'pending')

    // --- Auth UI ---
    if (authLoading) {
        return (
            <div className="auth-container">
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <div className="stat-label" style={{ marginBottom: '1rem' }}>Cargando seguridad...</div>
                    {connectionWarning && (
                        <motion.p 
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }}
                            style={{ color: '#f59e0b', fontSize: '0.875rem', maxWidth: '320px', margin: '0 auto', lineHeight: '1.4' }}
                        >
                            ⚠️ La conexión está tardando más de lo esperado. Si tu base de datos de Supabase estaba pausada por inactividad, puede demorar hasta 1 minuto en reactivarse de forma automática.
                        </motion.p>
                    )}
                </div>
            </div>
        )
    }

    if (authError) {
        return (
            <div className="auth-container">
                <div className="auth-card glass-card" style={{ textAlign: 'center', borderColor: '#ef4444', borderWidth: '1px', borderStyle: 'solid' }}>
                    <h2 style={{ color: '#ef4444', margin: '0 0 1rem 0', fontSize: '1.5rem' }}>Error de Conexión</h2>
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
                        No se pudo establecer comunicación con la base de datos de Supabase.
                    </p>
                    <p style={{ color: '#ef4444', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', padding: '0.75rem', borderRadius: '10px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {authError}
                    </p>
                    <button className="primary" onClick={() => window.location.reload()} style={{ marginTop: '1.5rem', background: '#374151' }}>
                        Reintentar
                    </button>
                </div>
            </div>
        )
    }

    if (!session) return (
        <div className="auth-container">
            <div className="auth-card glass-card">
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <h1 className="title" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>SHURIAN Finance</h1>
                    <p style={{ color: '#94a3b8' }}>{isRegistering ? 'Crear nueva cuenta' : 'Ingresar al Dashboard'}</p>
                </div>
                <form onSubmit={isRegistering ? handleSignUp : handleLogin}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label className="stat-label">EMAIL</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required />
                    </div>
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label className="stat-label">CONTRASEÑA</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
                    </div>
                    <button className="primary" style={{ width: '100%', padding: '1rem', background: 'var(--neon-green)', color: 'black' }}>
                        {isRegistering ? 'Registrarse' : 'Entrar'}
                    </button>
                </form>
                <button onClick={() => setIsRegistering(!isRegistering)} style={{ background: 'transparent', color: '#94a3b8', width: '100%', marginTop: '1rem', fontSize: '0.875rem' }}>
                    {isRegistering ? '¿Ya tenés cuenta? Ingresá' : '¿No tenés cuenta? Registrate'}
                </button>
            </div>
        </div>
    )

    // --- Main Dashboard ---
    return (
        <div className="dashboard-container">
            {/* Header */}
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="title" style={{ margin: 0 }}>SHURIAN Finance</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                        <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.875rem' }}>{session.user.email}</p>
                        <button onClick={handleLogout} style={{ background: 'transparent', color: '#ef4444', padding: '0 4px', fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <LogOut size={12} /> CERRAR SESIÓN
                        </button>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="glass-card" style={{ padding: '0.5rem 1rem', display: 'flex', gap: '0.5rem', borderRadius: '14px' }}>
                        {['ALL', 'Personal', 'SHURIAN'].map(f => (
                            <button key={f} className={filter === f ? 'primary' : ''} onClick={() => setFilter(f)}
                                style={{ background: filter === f ? '' : 'transparent', fontSize: '0.875rem' }}>
                                {f === 'ALL' ? 'Todo' : f}
                            </button>
                        ))}
                    </div>
                    <button className="primary" onClick={() => setShowSubs(!showSubs)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#6366f1', fontSize: '0.875rem' }}>
                        <RefreshCw size={16} /> Suscripciones
                    </button>
                    <button className="primary" onClick={() => setIsCreating(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--neon-green)', color: 'black', fontSize: '0.875rem' }}>
                        <Plus size={16} /> Nuevo Gasto
                    </button>
                </div>
            </header>

            {/* ========== WIDGET: DEUDAS PENDIENTES ========== */}
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>

                {/* Próximo vencimiento */}
                <div className="glass-card" style={{ padding: '1.25rem', background: 'linear-gradient(135deg, #1e3a8a22, #111827)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <Clock size={16} style={{ color: '#94a3b8' }} />
                        <span className="stat-label">PRÓXIMO VENCIMIENTO</span>
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>
                        {nextDue ? `${nextDue.entity}` : 'Sin pendientes 🎉'}
                    </div>
                    {nextDue && <div style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                        {format(parseISO(nextDue.due_date), 'dd MMMM', { locale: es })} · ${nextDue.amount.toLocaleString('es-AR')}
                    </div>}
                </div>

                {/* Deuda pendiente Personal */}
                <div className="glass-card" style={{ padding: '1.25rem', border: pendingTotals.personal > 0 ? '1px solid rgba(239,68,68,0.4)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <AlertTriangle size={16} style={{ color: pendingTotals.personal > 0 ? '#ef4444' : '#94a3b8' }} />
                        <span className="stat-label">DEUDA PENDIENTE PERSONAL</span>
                    </div>
                    <span className="stat-value" style={{ color: pendingTotals.personal > 0 ? '#ef4444' : '#22c55e', fontSize: '1.75rem' }}>
                        ${pendingTotals.personal.toLocaleString('es-AR')}
                    </span>
                </div>

                {/* Deuda pendiente SHURIAN */}
                <div className="glass-card" style={{ padding: '1.25rem', border: pendingTotals.shurian > 0 ? '1px solid rgba(239,68,68,0.4)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <AlertTriangle size={16} style={{ color: pendingTotals.shurian > 0 ? '#ef4444' : '#94a3b8' }} />
                        <span className="stat-label">DEUDA PENDIENTE SHURIAN</span>
                    </div>
                    <span className="stat-value" style={{ color: pendingTotals.shurian > 0 ? '#ef4444' : '#22c55e', fontSize: '1.75rem' }}>
                        ${pendingTotals.shurian.toLocaleString('es-AR')}
                    </span>
                </div>
            </motion.section>

            {/* ========== WIDGET: TERMÓMETRO SHURIAN ========== */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                className="glass-card" style={{ marginBottom: '1.5rem', padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <TrendingUp size={18} style={{ color: '#c084fc' }} />
                            <span style={{ fontWeight: 700, color: '#f1f5f9' }}>TERMÓMETRO DE FACTURACIÓN — SHURIAN</span>
                        </div>
                        <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>
                            Meta diaria: ${DAILY_GOAL.toLocaleString('es-AR')} × 20 días = <strong style={{ color: '#f1f5f9' }}>${monthlyGoal.toLocaleString('es-AR')}</strong> este mes
                        </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: progressColor }}>
                            {progressPct.toFixed(1)}%
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>comprometido en costos</div>
                    </div>
                </div>

                {/* Barra de termómetro */}
                <div style={{ background: '#1f2937', borderRadius: '999px', height: '14px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPct}%` }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                        style={{ height: '100%', background: `linear-gradient(90deg, #22c55e, ${progressColor})`, borderRadius: '999px' }}
                    />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                        Costos SHURIAN pendientes: <strong style={{ color: progressColor }}>${shurianPendingCost.toLocaleString('es-AR')}</strong>
                    </span>
                    <span style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                        Para cubrir costos hay que facturar: <strong style={{ color: '#f1f5f9' }}>${shurianPendingCost.toLocaleString('es-AR')}</strong>
                    </span>
                </div>
            </motion.div>

            {/* ========== SECCIÓN: SUSCRIPCIONES ========== */}
            <AnimatePresence>
                {showSubs && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="glass-card" style={{ marginBottom: '1.5rem', overflow: 'hidden', border: '1px solid #6366f1' }}>
                        <div style={{ padding: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <RefreshCw size={20} style={{ color: '#818cf8' }} /> Suscripciones Recurrentes
                                </h2>
                                <button onClick={() => setShowSubs(false)} style={{ background: 'transparent' }}><X size={18} /></button>
                            </div>

                            {/* Formulario nueva suscripción */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div>
                                    <label className="stat-label">ENTIDAD</label>
                                    <input type="text" placeholder="Ej: Alquiler, Netflix..." value={newSub.entity}
                                        onChange={e => setNewSub({ ...newSub, entity: e.target.value })} />
                                </div>
                                <div>
                                    <label className="stat-label">MONTO</label>
                                    <input type="number" placeholder="0.00" value={newSub.amount}
                                        onChange={e => setNewSub({ ...newSub, amount: e.target.value })} />
                                </div>
                                <div>
                                    <label className="stat-label">DÍA DE VENCIMIENTO</label>
                                    <input type="number" min="1" max="31" placeholder="1-31" value={newSub.due_day}
                                        onChange={e => setNewSub({ ...newSub, due_day: e.target.value })} />
                                </div>
                                <div>
                                    <label className="stat-label">CATEGORÍA</label>
                                    <select value={newSub.category} onChange={e => setNewSub({ ...newSub, category: e.target.value })}
                                        style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', padding: '0.75rem', borderRadius: '12px', color: 'white', marginTop: '0.5rem' }}>
                                        <option value="Personal">Personal</option>
                                        <option value="SHURIAN">SHURIAN</option>
                                    </select>
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label className="stat-label">CÓDIGO DE PAGO (OPCIONAL)</label>
                                    <input type="text" placeholder="VEP, Banelco..." value={newSub.payment_code}
                                        onChange={e => setNewSub({ ...newSub, payment_code: e.target.value })} />
                                </div>
                            </div>
                            <button className="primary" onClick={createSubscription}
                                style={{ background: '#6366f1', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                                <Plus size={16} /> Agregar Suscripción
                            </button>

                            {/* Lista de suscripciones */}
                            {subscriptions.length === 0 ? (
                                <p style={{ color: '#94a3b8', textAlign: 'center' }}>No hay suscripciones configuradas aún.</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {subscriptions.map(sub => (
                                        <div key={sub.id} style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '0.75rem 1rem', background: '#1f2937', borderRadius: '12px',
                                            opacity: sub.is_active ? 1 : 0.5
                                        }}>
                                            <div>
                                                <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{sub.entity}</span>
                                                <span style={{ color: '#94a3b8', fontSize: '0.8rem', marginLeft: '0.75rem' }}>
                                                    ${sub.amount.toLocaleString('es-AR')} · Día {sub.due_day} · {sub.category}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                <button onClick={() => toggleSubscription(sub)} style={{ background: 'transparent', color: sub.is_active ? '#22c55e' : '#94a3b8' }}>
                                                    {sub.is_active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                                                </button>
                                                <button onClick={() => deleteSubscription(sub.id)} style={{ background: 'transparent' }}>
                                                    <Trash2 size={16} style={{ color: '#ef4444' }} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ========== FORMULARIO: NUEVO GASTO ========== */}
            <AnimatePresence>
                {isCreating && (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                        className="glass-card" style={{ marginBottom: '2rem', border: '1px solid var(--neon-green)' }}>
                        <div style={{ padding: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                                <h2 style={{ margin: 0 }}>Cargar Gasto Manual</h2>
                                <button onClick={() => setIsCreating(false)} style={{ background: 'transparent' }}><X size={20} /></button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                                <div>
                                    <label className="stat-label">ENTIDAD</label>
                                    <input type="text" placeholder="Ej: EPE, AFIP..." value={newExpense.entity}
                                        onChange={e => setNewExpense({ ...newExpense, entity: e.target.value })} />
                                </div>
                                <div>
                                    <label className="stat-label">MONTO</label>
                                    <input type="number" placeholder="0.00" value={newExpense.amount}
                                        onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })} />
                                </div>
                                <div>
                                    <label className="stat-label">VENCIMIENTO</label>
                                    <input type="date" value={newExpense.due_date}
                                        onChange={e => setNewExpense({ ...newExpense, due_date: e.target.value })} />
                                </div>
                                <div>
                                    <label className="stat-label">CATEGORÍA</label>
                                    <select value={newExpense.category} onChange={e => setNewExpense({ ...newExpense, category: e.target.value })}
                                        style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', padding: '0.75rem', borderRadius: '12px', color: 'white', marginTop: '0.5rem' }}>
                                        <option value="Personal">Personal</option>
                                        <option value="SHURIAN">SHURIAN</option>
                                    </select>
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label className="stat-label">CÓDIGO DE PAGO (OPCIONAL)</label>
                                    <input type="text" placeholder="VEP, Banelco, Link..." value={newExpense.payment_code}
                                        onChange={e => setNewExpense({ ...newExpense, payment_code: e.target.value })} />
                                </div>
                            </div>
                            <button className="primary" onClick={createExpense}
                                style={{ marginTop: '1.5rem', width: '100%', background: 'var(--neon-green)', color: 'black' }}>
                                Guardar Gasto
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ========== LISTA DE GASTOS ========== */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={20} style={{ color: '#94a3b8' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#f1f5f9' }}>
                    {filter === 'ALL' ? 'Todos los Gastos' : `Gastos ${filter}`}
                    <span style={{ marginLeft: '0.75rem', fontSize: '0.875rem', color: '#94a3b8', fontWeight: 400 }}>
                        ({filteredExpenses.length})
                    </span>
                </h2>
            </div>

            <div className="vencimientos-grid">
                <AnimatePresence>
                    {filteredExpenses.map((expense) => (
                        <motion.div key={expense.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }} className={`expense-card glass-card ${expense.status}`}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                <span className={`badge ${expense.category === 'Personal' ? 'badge-personal' : 'badge-shurian'}`}>
                                    {expense.category.toUpperCase()}
                                </span>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <button onClick={() => startEditing(expense)} style={{ background: 'transparent', padding: '4px' }}>
                                        <Edit2 size={14} style={{ color: '#94a3b8' }} />
                                    </button>
                                    <button onClick={() => deleteExpense(expense.id)} style={{ background: 'transparent', padding: '4px' }}>
                                        <Trash2 size={14} style={{ color: '#ef4444' }} />
                                    </button>
                                    <span className={expense.status === 'paid' ? 'neon-green' : 'neon-red'}
                                        style={{ fontWeight: 700, fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                                        {expense.status === 'paid' ? 'PAGADO' : 'PENDIENTE'}
                                    </span>
                                </div>
                            </div>

                            {editingId === expense.id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <input type="text" value={editForm.entity} onChange={e => setEditForm({ ...editForm, entity: e.target.value })} />
                                    <input type="number" value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} />
                                    <input type="date" value={editForm.due_date} onChange={e => setEditForm({ ...editForm, due_date: e.target.value })} />
                                    <input type="text" placeholder="Código de pago" value={editForm.payment_code || ''} onChange={e => setEditForm({ ...editForm, payment_code: e.target.value })} />
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button className="primary" onClick={saveEdit} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                            <Save size={16} /> Guardar
                                        </button>
                                        <button onClick={() => setEditingId(null)} style={{ background: '#374151', color: 'white' }}>
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem' }}>{expense.entity}</h3>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>
                                        ${expense.amount.toLocaleString('es-AR')}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Calendar size={14} />
                                            <span>Vence: {format(parseISO(expense.due_date), 'dd MMMM, yyyy', { locale: es })}</span>
                                        </div>
                                        {expense.invoice_number && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
                                                <span style={{ fontSize: '0.8rem' }}>N° {expense.invoice_number}</span>
                                            </div>
                                        )}
                                        {expense.payment_code && (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1f2937', padding: '0.5rem', borderRadius: '10px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                                                    <AlertCircle size={14} />
                                                    <span style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{expense.payment_code}</span>
                                                </div>
                                                <button onClick={() => copyToClipboard(expense.payment_code)} style={{ background: 'transparent', padding: '4px' }}>
                                                    <Copy size={14} className="accent-blue" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {expense.status === 'pending' && (
                                        <button className="primary"
                                            style={{ width: '100%', marginTop: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'var(--accent-blue)' }}
                                            onClick={() => markAsPaid(expense.id)}>
                                            <CheckCircle2 size={18} /> Marcar como Pagado
                                        </button>
                                    )}
                                </>
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {loading && <div style={{ textAlign: 'center', padding: '4rem' }}><div className="stat-label">Cargando finanzas...</div></div>}
            {!loading && filteredExpenses.length === 0 && (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#94a3b8' }}>
                    No hay gastos en esta categoría. ¡Excelente! 🎉
                </div>
            )}
        </div>
    )
}
