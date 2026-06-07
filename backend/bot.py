import logging
import os
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, HTTPServer
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, 
    CommandHandler, 
    ContextTypes, 
    MessageHandler, 
    CallbackQueryHandler, 
    ConversationHandler, 
    filters
)
from config import TELEGRAM_TOKEN, ADMIN_ID, SUPABASE_USER_ID
from extractor import process_document

# Configuración de logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Diccionario temporal para guardar estado por usuario (en memoria por simplicidad para 1 usuario)
user_data_store = {}

# Estados para la conversación de carga manual
GET_ENTITY, GET_AMOUNT, GET_DUE_DATE, GET_CATEGORY, GET_PAYMENT_CODE = range(5)

def is_admin(update: Update) -> bool:
    if update.effective_user.id != ADMIN_ID:
        logger.warning(f"Acceso denegado al usuario: {update.effective_user.id}")
        return False
    return True

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update):
        await update.message.reply_text("Acceso denegado. No eres el administrador de este bot.")
        return
    
    await update.message.reply_text(
        "¡Hola Julián! Soy tu Tracker Financiero Personal.\n"
        "Enviame cualquier factura en formato PDF o Imagen y yo me encargaré de extraer los datos y guardar el registro."
    )

async def handle_document(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info(f"Nuevo mensaje recibido: {update.message.message_id}")
    if not is_admin(update):
        logger.warning(f"Acceso denegado para usuario {update.effective_user.id}")
        return
        
    message = update.message
    document = message.document or message.photo
    
    if not document:
        return
        
    await message.reply_text("Recibí el archivo. Analizándolo con la IA... ⏳")
    
    try:
        # Si es foto, Telegram manda una tupla de PhotoSize, tomamos la de mayor resolución (-1)
        # Si es document, es un objeto Document directo.
        if message.photo:
            file_obj = message.photo[-1]
            tipo_archivo = "jpg"
        else:
            file_obj = message.document
            tipo_archivo = "pdf" if getattr(file_obj, 'mime_type', '') == 'application/pdf' else "jpg"
            
        file_id = file_obj.file_id
        
        new_file = await context.bot.get_file(file_id)
        
        # Crear carpeta temp si no existe
        os.makedirs("temp", exist_ok=True)
        
        file_path = f"temp/{file_id}.{tipo_archivo}"
        
        logger.info(f"Descargando archivo {file_id} a {file_path}")
        await new_file.download_to_drive(file_path)
        
        # Procesar con Gemini
        data = process_document(file_path)
        
        if not data:
            await message.reply_text("❌ No pude extraer los datos correctamente. Por favor revisá el formato del archivo o intentá nuevamente.")
            if os.path.exists(file_path):
                os.remove(file_path)
            return
            
        # Guardar en diccionario temporal
        user_data_store[update.effective_user.id] = {
            "extracted_data": data,
            "file_path": file_path
        }
        
        resumen = (
            f"📄 **Datos Extraídos:**\n\n"
            f"🏢 Entidad: `{data.get('entidad', 'N/A')}`\n"
            f"💰 Monto: `${data.get('monto_total', 0.0):.2f}`\n"
            f"📅 Vencimiento: `{data.get('fecha_vencimiento', 'N/A')}`\n"
            f"🔢 Código: `{data.get('codigo_pago', 'N/A')}`\n\n"
            f"¿A qué categoría pertenece este gasto?"
        )
        
        keyboard = [
            [
                InlineKeyboardButton("🏠 Personal", callback_data='cat_Personal'),
                InlineKeyboardButton("🏢 SHURIAN", callback_data='cat_SHURIAN')
            ],
            [
                InlineKeyboardButton("❌ Cancelar", callback_data='cat_cancel')
            ]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        await message.reply_text(resumen, reply_markup=reply_markup, parse_mode='Markdown')
        
    except Exception as e:
        logger.error(f"Error procesando documento: {e}")
        await message.reply_text(f"Hubo un error procesando tu archivo: {str(e)}")

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    user_id = update.effective_user.id
    if user_id not in user_data_store:
        await query.edit_message_text("❌ Sesión expirada. Por favor, enviá el archivo nuevamente.")
        return
        
    data = query.data
    
    if data == 'cat_cancel':
        file_path = user_data_store[user_id].get("file_path")
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
        del user_data_store[user_id]
        await query.edit_message_text("❌ Operación cancelada.")
        return
        
    if data == 'save_confirm':
        ext_data = user_data_store[user_id]['extracted_data']
        category = user_data_store[user_id]['category']
        
        # Validar y formatear fecha
        raw_date = ext_data.get('fecha_vencimiento', '')
        try:
            parsed_date = datetime.strptime(raw_date, '%d/%m/%Y').strftime('%Y-%m-%d')
        except ValueError:
            parsed_date = datetime.now().strftime('%Y-%m-%d')
        
        entity = ext_data.get('entidad', 'N/A')
        amount = ext_data.get('monto_total', 0.0)
        invoice_number = ext_data.get('numero_comprobante', None)
        payment_code = ext_data.get('codigo_pago', None)
            
        try:
            from config import supabase
            
            # --- VERIFICACIÓN DE DUPLICADOS ---
            if invoice_number:
                # Buscar por número de comprobante
                dup_check = supabase.table('expenses').select('id').eq('user_id', SUPABASE_USER_ID).eq('invoice_number', str(invoice_number)).execute()
            else:
                # Fallback: buscar por entidad + monto + fecha
                dup_check = supabase.table('expenses').select('id') \
                    .eq('user_id', SUPABASE_USER_ID) \
                    .eq('entity', entity) \
                    .eq('amount', amount) \
                    .eq('due_date', parsed_date).execute()
            
            if dup_check.data and len(dup_check.data) > 0:
                await query.edit_message_text(
                    f"⚠️ **Duplicado detectado**\n\n"
                    f"Ya existe un gasto de `{entity}` por `${amount:.2f}` con vencimiento `{raw_date}` en la base de datos.\n"
                    f"No se guardó para evitar duplicados.",
                    parse_mode='Markdown'
                )
            else:
                supabase.table('expenses').insert({
                    "user_id": SUPABASE_USER_ID,
                    "entity": entity,
                    "category": category,
                    "amount": amount,
                    "due_date": parsed_date,
                    "payment_code": payment_code,
                    "invoice_number": str(invoice_number) if invoice_number else None
                }).execute()
                await query.edit_message_text(
                    f"✅ ¡Gasto de **{category}** guardado exitosamente!"
                    + (f"\n🧾 Comprobante: `{invoice_number}`" if invoice_number else ""),
                    parse_mode='Markdown'
                )
            
        except Exception as e:
            logger.error(f"Error insertando en BD: {e}")
            await query.edit_message_text("❌ Ocurrió un error al guardar en la base de datos.")
            
        finally:
            file_path = user_data_store[user_id].get("file_path")
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
            del user_data_store[user_id]
        return
        
    if data.startswith('cat_'):
        # Obtener la categoría elegida
        category = data.split('_')[1] # 'Personal' o 'SHURIAN'
        user_data_store[user_id]['category'] = category
        
        # Próximo paso: Confirmar Guardado
        ext_data = user_data_store[user_id]['extracted_data']
        resumen_final = (
            f"✅ ¡Categoría asignada: **{category}**!\n\n"
            f"🏢 Entidad: `{ext_data.get('entidad', 'N/A')}`\n"
            f"💰 Monto: `${ext_data.get('monto_total', 0.0):.2f}`\n"
            f"📅 Vencimiento: `{ext_data.get('fecha_vencimiento', 'N/A')}`\n\n"
            f"¿Confirmás guardar este registro en Supabase?"
        )
        
        keyboard = [
            [
                InlineKeyboardButton("💾 Confirmar Guardado", callback_data='save_confirm'),
                InlineKeyboardButton("❌ Cancelar", callback_data='cat_cancel')
            ]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        await query.edit_message_text(resumen_final, reply_markup=reply_markup, parse_mode='Markdown')
        return

# --- Flujo de Carga Manual (/nuevo) ---

async def nuevo_gasto_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update): return ConversationHandler.END
    await update.message.reply_text("📝 **Carga Manual de Gasto**\n\n¿Cuál es la empresa o entidad? (Ej: EPE, AFIP, Alquiler)")
    return GET_ENTITY

async def get_entity(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['manual_entity'] = update.message.text
    await update.message.reply_text(f"💰 ¿Cuál es el monto total para **{update.message.text}**? (Solo el número)")
    return GET_AMOUNT

async def get_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        monto = float(update.message.text.replace(',', '.'))
        context.user_data['manual_amount'] = monto
        await update.message.reply_text("📅 ¿Cuándo vence? (Formato: DD/MM/AAAA o poné 'hoy')")
        return GET_DUE_DATE
    except ValueError:
        await update.message.reply_text("❌ Por favor, enviá un número válido para el monto.")
        return GET_AMOUNT

async def get_due_date(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message.text.lower()
    if msg == 'hoy':
        fecha = datetime.now().strftime('%d/%m/%Y')
    else:
        fecha = msg
    
    context.user_data['manual_date'] = fecha
    await update.message.reply_text("🔢 ¿Tenés un código de pago o VEP? (Si no tenés, poné '-')")
    return GET_PAYMENT_CODE

async def get_payment_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['manual_code'] = update.message.text
    
    keyboard = [
        [
            InlineKeyboardButton("🏠 Personal", callback_data='manual_cat_Personal'),
            InlineKeyboardButton("🏢 SHURIAN", callback_data='manual_cat_SHURIAN')
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text("🏷️ Por último, seleccioná la categoría:", reply_markup=reply_markup)
    return GET_CATEGORY

async def handle_manual_category(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    category = query.data.split('_')[-1]
    
    entity = context.user_data['manual_entity']
    amount = context.user_data['manual_amount']
    date_str = context.user_data['manual_date']
    code = context.user_data['manual_code']

    try:
        parsed_date = datetime.strptime(date_str, '%d/%m/%Y').strftime('%Y-%m-%d')
    except ValueError:
        parsed_date = datetime.now().strftime('%Y-%m-%d')

    try:
        from config import supabase
        
        # --- VERIFICACIÓN DE DUPLICADOS (carga manual, sin número de comprobante) ---
        dup_check = supabase.table('expenses').select('id') \
            .eq('user_id', SUPABASE_USER_ID) \
            .eq('entity', entity) \
            .eq('amount', amount) \
            .eq('due_date', parsed_date).execute()
        
        if dup_check.data and len(dup_check.data) > 0:
            await query.edit_message_text(
                f"⚠️ **Duplicado detectado**\n\n"
                f"Ya existe un gasto de `{entity}` por `${amount:.2f}` con vencimiento `{date_str}`.\n"
                f"No se guardó para evitar duplicados.",
                parse_mode='Markdown'
            )
        else:
            supabase.table('expenses').insert({
                "user_id": SUPABASE_USER_ID,
                "entity": entity,
                "category": category,
                "amount": amount,
                "due_date": parsed_date,
                "payment_code": code if code != '-' else None
            }).execute()
            await query.edit_message_text(f"✅ **Gasto Guardado Manualmente**\n\n🏢 Entidad: {entity}\n💰 Monto: ${amount:.2f}\n📅 Vence: {date_str}\n🏷️ Categoría: {category}")
    except Exception as e:
        logger.error(f"Error carga manual: {e}")
        await query.edit_message_text("❌ Error al guardar en base de datos.")
    
    return ConversationHandler.END

async def cancel_manual(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Operación cancelada.")
    return ConversationHandler.END

# --- Comandos Adicionales ---

async def editar_gasto(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update): return
    
    try:
        from config import supabase
        # Traer los últimos 5 gastos pendientes
        response = supabase.table('expenses').select('*').eq('status', 'pending').order('due_date', { 'ascending': True }).limit(5).execute()
        expenses = response.data
        
        if not expenses:
            await update.message.reply_text("No hay gastos pendientes para editar. ¡Estás al día! 🙌")
            return
            
        msg = "🔍 **Gastos Pendientes (Últimos 5):**\n\n"
        keyboard = []
        for e in expenses:
            fecha = datetime.strptime(e['due_date'], '%Y-%m-%d').strftime('%d/%m')
            msg += f"• {e['entity']} (${e['amount']}) - Vence: {fecha}\n"
            # Creamos un botón para borrar o marcar como pagado rápido
            keyboard.append([InlineKeyboardButton(f"✅ Pagado: {e['entity']}", callback_data=f"quickpay_{e['id']}")])
            
        msg += "\n*Para editar montos o nombres con precisión, te recomiendo usar el Dashboard Web.*"
        reply_markup = InlineKeyboardMarkup(keyboard)
        await update.message.reply_text(msg, reply_markup=reply_markup, parse_mode='Markdown')
        
    except Exception as e:
        logger.error(f"Error en editar_gasto: {e}")
        await update.message.reply_text("Error al consultar gastos.")

async def handle_callback_extended(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    data = query.data
    logger.info(f"--- NUEVO CALLBACK RECIBIDO: {data}")
    
    if data.startswith('quickpay_'):
        expense_id = data.split('_')[1]
        try:
            from config import supabase
            supabase.table('expenses').update({"status": "paid"}).eq('id', expense_id).execute()
            await query.answer("¡Gasto marcado como pagado!")
            await query.edit_message_text("✅ Gasto actualizado correctamente.")
        except Exception as e:
            await query.answer("Error al actualizar.")
        return

    # Si es manual_cat_, redirigir al handler de manual
    if data.startswith('manual_cat_'):
        return await handle_manual_category(update, context)
        
    # De lo contrario, usar el original
    await handle_callback(update, context)

# Servidor web simple para el Health Check en Render (capa gratuita)
class HealthCheckHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"OK")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Omitimos los logs de peticiones HTTP para evitar ruido en el bot_debug.log
        pass

def start_health_server():
    port = os.getenv("PORT")
    if port:
        try:
            port = int(port)
            server = HTTPServer(('0.0.0.0', port), HealthCheckHandler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            logger.info(f"Servidor de salud iniciado en el puerto {port}")
        except Exception as e:
            logger.error(f"Error al iniciar el servidor de salud: {e}")
    else:
        logger.info("Variable de entorno PORT no configurada. Omitiendo servidor de salud.")

def main():
    if not TELEGRAM_TOKEN:
        logger.error("No se encontró TELEGRAM_TOKEN. Saliendo...")
        return
        
    start_health_server()
        
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()

    # Tareas en JobQueue
    from alerts import check_pending_expenses
    from subscriptions_cron import inject_monthly_subscriptions
    from datetime import time
    
    job_queue = app.job_queue
    # Alerta de vencimientos: todos los días a las 09:00 AM
    hora_aviso = time(hour=9, minute=0, second=0)
    job_queue.run_daily(check_pending_expenses, time=hora_aviso, name='Aviso-24h')
    
    # Cron de suscripciones: se ejecuta todos los días a las 08:00 AM
    # La lógica dentro de la función debe verificar si es el día 1 del mes.
    hora_subs = time(hour=8, minute=0, second=0)
    job_queue.run_daily(inject_monthly_subscriptions, time=hora_subs, name='Subs-Mensuales')

    # Handlers Base
    # Handlers Carga Manual
    manual_conv = ConversationHandler(
        entry_points=[CommandHandler("nuevo", nuevo_gasto_start)],
        states={
            GET_ENTITY: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_entity)],
            GET_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_amount)],
            GET_DUE_DATE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_due_date)],
            GET_PAYMENT_CODE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_payment_code)],
            GET_CATEGORY: [CallbackQueryHandler(handle_manual_category, pattern='^manual_cat_')]
        },
        fallbacks=[CommandHandler("cancelar", cancel_manual)]
    )

    # Handlers Base
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("editar", editar_gasto))
    app.add_handler(manual_conv)
    app.add_handler(MessageHandler(filters.Document.ALL | filters.PHOTO, handle_document))
    app.add_handler(CallbackQueryHandler(handle_callback_extended))

    logger.info("Iniciando el bot y JobQueue diario...")
    app.run_polling()

if __name__ == '__main__':
    main()
