import os
import discord
from discord import app_commands

# ──────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────
TOKEN            = os.environ["DISCORD_TOKEN"]
RULES_CHANNEL_ID = 1556698201107464314
PLAYER_ROLE_ID   = 1557353276641644634
EMOJI            = "✅"
SCAN_LIMIT       = 50  # startup scan: kaç eski mesaj taransın

# ──────────────────────────────────────────
#  BOT SETUP
# ──────────────────────────────────────────
intents          = discord.Intents.default()
intents.members  = True
intents.reactions = True


class AuraBot(discord.Client):
    def __init__(self) -> None:
        super().__init__(intents=intents)
        self.tree    = app_commands.CommandTree(self)
        self.scanned = False

    async def setup_hook(self) -> None:
        """Slash komutlarını Discord'a kaydet (bot her başladığında)."""
        await self.tree.sync()
        print("Slash commands synced.")


client = AuraBot()


# ──────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────
async def get_member(guild: discord.Guild, user_id: int) -> discord.Member | None:
    """Cache'de yoksa API'den üye çek."""
    member = guild.get_member(user_id)
    if member is None:
        try:
            member = await guild.fetch_member(user_id)
        except discord.NotFound:
            return None
    return member


# ──────────────────────────────────────────
#  MODAL — /rules komutu açar bunu
# ──────────────────────────────────────────
class RulesModal(discord.ui.Modal, title="📋 Kuralları Yaz"):
    rules_text = discord.ui.TextInput(
        label="Kurallar",
        style=discord.TextStyle.long,
        placeholder="Kuralları buraya yaz...\n1. Saygılı ol\n2. ...",
        required=True,
        max_length=2000,
    )

    async def on_submit(self, interaction: discord.Interaction) -> None:
        """Modal gönderilince kurallar kanalına yaz ve ✅ ekle."""
        channel = client.get_channel(RULES_CHANNEL_ID)
        if channel is None:
            await interaction.response.send_message(
                "❌ Kurallar kanalı bulunamadı! `RULES_CHANNEL_ID`'yi kontrol et.",
                ephemeral=True,
            )
            return

        # Kuralları gönder ve reaksiyon ekle
        message = await channel.send(self.rules_text.value)
        await message.add_reaction(EMOJI)

        await interaction.response.send_message(
            f"✅ Kurallar #{channel.name} kanalına gönderildi!",
            ephemeral=True,  # Sadece komutu kullanan görür
        )

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        await interaction.response.send_message(
            "❌ Bir hata oluştu.", ephemeral=True
        )
        raise error


# ──────────────────────────────────────────
#  SLASH COMMAND — /rules
# ──────────────────────────────────────────
@client.tree.command(name="rules", description="Kural mesajı oluştur ve kurallar kanalına gönder")
@app_commands.checks.has_permissions(administrator=True)
async def rules_command(interaction: discord.Interaction) -> None:
    """Sadece yöneticiler kullanabilir. Modal penceresi açar."""
    await interaction.response.send_modal(RulesModal())


@rules_command.error
async def rules_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError) -> None:
    if isinstance(error, app_commands.MissingPermissions):
        await interaction.response.send_message(
            "❌ Bu komutu kullanmak için **Yönetici** yetkisine ihtiyacın var.",
            ephemeral=True,
        )


# ──────────────────────────────────────────
#  EVENTS
# ──────────────────────────────────────────
@client.event
async def on_ready() -> None:
    print(f"Logged in as {client.user}")

    # on_ready yeniden bağlanmada tekrar tetiklenebilir — sadece bir kez tara
    if client.scanned:
        return
    client.scanned = True

    channel = client.get_channel(RULES_CHANNEL_ID)
    if channel is None:
        print("Rules channel not found.")
        return

    guild = channel.guild
    role  = guild.get_role(PLAYER_ROLE_ID)
    if role is None:
        print("Player role not found.")
        return

    # Startup: kaçırılan ✅ reaksiyonlarını tara ve rol ver
    given = 0
    async for message in channel.history(limit=SCAN_LIMIT):
        for reaction in message.reactions:
            if str(reaction.emoji) != EMOJI:
                continue
            async for user in reaction.users():
                if user.bot:
                    continue
                member = await get_member(guild, user.id)
                if member is None or role in member.roles:
                    continue
                try:
                    await member.add_roles(role, reason="Accepted the rules (startup scan)")
                    given += 1
                except discord.Forbidden:
                    print("Missing permissions: bot rolü Player rolünün üstünde olmalı.")
                    return

    print(f"Startup scan tamamlandı — {given} üyeye rol verildi.")


@client.event
async def on_raw_reaction_add(payload: discord.RawReactionActionEvent) -> None:
    """Kullanıcı ✅ reaksiyonu eklediğinde Player rolü ver."""
    if payload.channel_id != RULES_CHANNEL_ID or str(payload.emoji) != EMOJI:
        return
    if payload.user_id == client.user.id:
        return

    guild = client.get_guild(payload.guild_id)
    if guild is None:
        return

    member = payload.member or await get_member(guild, payload.user_id)
    role   = guild.get_role(PLAYER_ROLE_ID)
    if member is None or role is None or role in member.roles:
        return

    try:
        await member.add_roles(role, reason="Accepted the rules")
    except discord.Forbidden:
        print("Missing permissions: bot rolü Player rolünün üstünde olmalı.")


@client.event
async def on_raw_reaction_remove(payload: discord.RawReactionActionEvent) -> None:
    """Kullanıcı ✅ reaksiyonunu kaldırdığında Player rolünü al."""
    if payload.channel_id != RULES_CHANNEL_ID or str(payload.emoji) != EMOJI:
        return
    if payload.user_id == client.user.id:
        return

    guild = client.get_guild(payload.guild_id)
    if guild is None:
        return

    member = await get_member(guild, payload.user_id)
    role   = guild.get_role(PLAYER_ROLE_ID)
    if member is None or role is None or role not in member.roles:
        return

    try:
        await member.remove_roles(role, reason="Removed the rules reaction")
    except discord.Forbidden:
        print("Missing permissions: bot rolü Player rolünün üstünde olmalı.")


# ──────────────────────────────────────────
#  RUN
# ──────────────────────────────────────────
client.run(TOKEN)