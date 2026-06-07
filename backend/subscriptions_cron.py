"""
subscriptions_cron.py
Inyecta los gastos recurrentes (suscripciones activas) en la tabla expenses
al comienzo de cada mes. Se llama desde el scheduler en bot.py.
"""
import logging
from datetime import datetime
import calendar
from dotenv import load_dotenv

load_dotenv()
from config import supabase, SUPABASE_USER_ID

logger = logging.getLogger(__name__)


async def inject_monthly_subscriptions(context=None, force_day_check=False):
    """
    Busca todas las suscripciones activas del usuario y crea un registro
    en 'expenses' para el mes actual si todavía no existe.
    """
    now = datetime.now()
    if now.day != 1 and not force_day_check:
        logger.info(f"[CRON] Hoy es día {now.day}. Solo se procesan suscripciones el día 1. Finalizando.")
        return

    current_month = now.month
    current_year = now.year

    try:
        # Obtener suscripciones activas
        res = supabase.table("subscriptions") \
            .select("*") \
            .eq("user_id", SUPABASE_USER_ID) \
            .eq("is_active", True) \
            .execute()

        subscriptions = res.data or []
        logger.info(f"[CRON] Procesando {len(subscriptions)} suscripciones activas para {current_month}/{current_year}")

        inserted = 0
        skipped = 0

        for sub in subscriptions:
            # Calcular la fecha de vencimiento de este mes
            max_day = calendar.monthrange(current_year, current_month)[1]
            due_day = min(sub["due_day"], max_day)
            due_date = f"{current_year}-{current_month:02d}-{due_day:02d}"

            # Verificar si ya existe el gasto de esta suscripción este mes
            dup = supabase.table("expenses") \
                .select("id") \
                .eq("user_id", SUPABASE_USER_ID) \
                .eq("entity", sub["entity"]) \
                .eq("amount", sub["amount"]) \
                .eq("due_date", due_date) \
                .execute()

            if dup.data and len(dup.data) > 0:
                logger.info(f"[CRON] YA EXISTE: {sub['entity']} vence {due_date}. Skipping.")
                skipped += 1
                continue

            # Insertar gasto mensual
            supabase.table("expenses").insert({
                "user_id": SUPABASE_USER_ID,
                "entity": sub["entity"],
                "category": sub["category"],
                "amount": sub["amount"],
                "due_date": due_date,
                "payment_code": sub.get("payment_code"),
                "status": "pending"
            }).execute()

            logger.info(f"[CRON] INSERTADO: {sub['entity']} ${sub['amount']} vence {due_date}")
            inserted += 1

        logger.info(f"[CRON] Completado: {inserted} insertados, {skipped} omitidos.")

    except Exception as e:
        logger.error(f"[CRON] Error inyectando suscripciones: {e}")


if __name__ == "__main__":
    import asyncio
    import sys

    # Configuración de logging para cuando se ejecuta desde consola
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # Permitir la opción --force por línea de comandos para saltarse la validación del día 1
    force = "--force" in sys.argv
    if force:
        logger.info("[CRON] Ejecución forzada desde consola activa (--force).")

    asyncio.run(inject_monthly_subscriptions(force_day_check=force))
