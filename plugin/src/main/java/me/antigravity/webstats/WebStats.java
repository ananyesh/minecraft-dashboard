package me.antigravity.webstats;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.configuration.file.FileConfiguration;
import java.io.File;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.entities.Activity;
import net.dv8tion.jda.api.events.message.MessageReceivedEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.requests.GatewayIntent;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedList;
import java.util.concurrent.ConcurrentHashMap;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;
import java.io.OutputStream;
import java.nio.file.Files;
import java.net.InetSocketAddress;

public class WebStats extends JavaPlugin implements Listener {

    private HttpServer webServer;
    private final ConcurrentHashMap<String, String> playerCache = new ConcurrentHashMap<>();
    private String serverHealthCache = "{}";
    private String historyCache = "[]";

    private String databaseURL;
    private FileConfiguration eloConfig;
    private File eloFile;
    private final Object eloLock = new Object();
    
    // Discord Bot & Whitelist
    private JDA jda;
    private File whitelistFile;
    private FileConfiguration whitelistConfig;
    
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final LinkedList<String> pulseHistory = new LinkedList<>();
    private long lastTick = System.currentTimeMillis();
    private double currentTps = 20.0;

    private final java.util.Map<java.util.UUID, java.util.Map<java.util.UUID, Long>> lastKillTime = new java.util.HashMap<>();
    private final java.util.Map<java.util.UUID, Integer> lastRankMap = new java.util.HashMap<>();
    private final java.util.LinkedList<String> liveLogs = new java.util.LinkedList<>();

    // Network Tracking
    private long lastNetIn = -1, lastNetOut = -1, lastNetTime = -1;
    private double netInMbps = 0, netOutMbps = 0;

    private void updateNetworkStats() {
        long now = System.currentTimeMillis();
        if (lastNetTime == -1) {
            lastNetTime = now;
            long[] current = getSystemNetworkBytes();
            lastNetIn = current[0]; lastNetOut = current[1];
            return;
        }

        long diffMs = now - lastNetTime;
        if (diffMs < 5000) return; // Update every 5s

        long[] current = getSystemNetworkBytes();
        if (current[0] != -1 && current[1] != -1 && lastNetIn != -1) {
            long inDiff = current[0] - lastNetIn;
            long outDiff = current[1] - lastNetOut;
            if (inDiff < 0) inDiff = 0; if (outDiff < 0) outDiff = 0; // Overflow protection
            
            double seconds = diffMs / 1000.0;
            netInMbps = (inDiff * 8.0) / (seconds * 1024.0 * 1024.0);
            netOutMbps = (outDiff * 8.0) / (seconds * 1024.0 * 1024.0);
        }
        lastNetIn = current[0]; lastNetOut = current[1];
        lastNetTime = now;
    }

    private long[] getSystemNetworkBytes() {
        String os = System.getProperty("os.name").toLowerCase();
        if (os.contains("win")) return getWindowsNetworkBytes();
        return getLinuxNetworkBytes();
    }

    private long[] getWindowsNetworkBytes() {
        try {
            java.util.Scanner s = new java.util.Scanner(Runtime.getRuntime().exec("netstat -e").getInputStream());
            while (s.hasNextLine()) {
                String line = s.nextLine();
                if (line.toLowerCase().contains("bytes")) {
                    String[] parts = line.trim().split("\\s+");
                    if (parts.length >= 3) return new long[]{Long.parseLong(parts[1]), Long.parseLong(parts[2])};
                }
            }
        } catch (Exception ignored) {}
        return new long[]{-1, -1};
    }

    private long[] getLinuxNetworkBytes() {
        try {
            java.util.List<String> lines = java.nio.file.Files.readAllLines(java.nio.file.Paths.get("/proc/net/dev"));
            long totalIn = 0, totalOut = 0;
            for (String line : lines) {
                if (line.contains(":") && !line.contains("lo:")) {
                    String[] parts = line.trim().split(":")[1].trim().split("\\s+");
                    totalIn += Long.parseLong(parts[0]);
                    totalOut += Long.parseLong(parts[8]);
                }
            }
            return new long[]{totalIn, totalOut};
        } catch (Exception ignored) {}
        return new long[]{-1, -1};
    }

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadConfig();
        
        eloFile = new File(getDataFolder(), "elo.yml");
        if (!eloFile.exists()) saveResource("elo.yml", false);
        eloConfig = YamlConfiguration.loadConfiguration(eloFile);

        whitelistFile = new File(getDataFolder(), "whitelist_map.yml");
        whitelistConfig = YamlConfiguration.loadConfiguration(whitelistFile);

        getServer().getPluginManager().registerEvents(this, this);

        startTelemetrySync();
        startDiscordBot();
        startWebServer();
        
        getLogger().info("WebStats enabled! Dashboard hosted on port " + getConfig().getInt("web-port", 8080));
    }

    private void startWebServer() {
        int port = getConfig().getInt("web-port", 8080);
        try {
            webServer = HttpServer.create(new InetSocketAddress(port), 0);
            
            // API Endpoint: Returns all data as one big JSON
            webServer.createContext("/api/data", exchange -> {
                StringBuilder json = new StringBuilder("{\"server\":").append(serverHealthCache)
                    .append(",\"players\":{");
                boolean first = true;
                for (java.util.Map.Entry<String, String> entry : playerCache.entrySet()) {
                    if (!first) json.append(",");
                    json.append("\"").append(entry.getKey()).append("\":").append(entry.getValue());
                    first = false;
                }
                json.append("},\"history\":").append(historyCache)
                    .append(",\"live_logs\":[").append(String.join(",", liveLogs)).append("]}");
                
                byte[] response = json.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                exchange.sendResponseHeaders(200, response.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(response); }
            });

            // File Server: Serves index.html, style.css, app.js from /web folder
            webServer.createContext("/", exchange -> {
                String path = exchange.getRequestURI().getPath();
                if (path.equals("/")) path = "/index.html";
                
                File webFolder = new File(getDataFolder(), "web");
                if (!webFolder.exists()) webFolder.mkdirs();
                
                File file = new File(webFolder, path.substring(1));
                if (file.exists() && file.isFile()) {
                    String contentType = "text/plain";
                    if (path.endsWith(".html")) contentType = "text/html";
                    else if (path.endsWith(".css")) contentType = "text/css";
                    else if (path.endsWith(".js")) contentType = "application/javascript";
                    
                    byte[] response = Files.readAllBytes(file.toPath());
                    exchange.getResponseHeaders().set("Content-Type", contentType);
                    exchange.sendResponseHeaders(200, response.length);
                    try (OutputStream os = exchange.getResponseBody()) { os.write(response); }
                } else {
                    String msg = "404 Not Found";
                    exchange.sendResponseHeaders(404, msg.length());
                    try (OutputStream os = exchange.getResponseBody()) { os.write(msg.getBytes()); }
                }
            });

            webServer.setExecutor(null);
            webServer.start();
        } catch (Exception e) {
            getLogger().severe("Failed to start Web Server: " + e.getMessage());
        }
    }

    private void startDiscordBot() {
        String token = getConfig().getString("discord-bot-token", "");
        String channelId = getConfig().getString("whitelist-channel-id", "");

        if (token.isEmpty() || channelId.isEmpty()) {
            getLogger().warning("Discord Bot Token or Channel ID missing in config. Whitelist system disabled.");
            return;
        }

        try {
            jda = JDABuilder.createDefault(token)
                .enableIntents(GatewayIntent.GUILD_MESSAGES, GatewayIntent.MESSAGE_CONTENT)
                .setActivity(Activity.watching("the whitelist"))
                .addEventListeners(new ListenerAdapter() {
                    @Override
                    public void onMessageReceived(MessageReceivedEvent event) {
                        if (!event.getChannel().getId().equals(channelId)) return;
                        if (event.getAuthor().isBot()) return;

                        String message = event.getMessage().getContentRaw().trim();
                        String discordId = event.getAuthor().getId();

                        // Rule: One account per Discord user
                        if (whitelistConfig.contains(discordId)) {
                            event.getMessage().addReaction(net.dv8tion.jda.api.entities.emoji.Emoji.fromUnicode("❌")).queue();
                            event.getChannel().sendMessage("❌ " + event.getAuthor().getAsMention() + ", you have already whitelisted an account (" + whitelistConfig.getString(discordId) + ").").queue();
                            return;
                        }

                        // Rule: One Discord user per IGN (Prevent stealing)
                        for (String key : whitelistConfig.getKeys(false)) {
                            if (whitelistConfig.getString(key, "").equalsIgnoreCase(message)) {
                                event.getMessage().addReaction(net.dv8tion.jda.api.entities.emoji.Emoji.fromUnicode("❌")).queue();
                                event.getChannel().sendMessage("❌ " + event.getAuthor().getAsMention() + ", the account **" + message + "** is already whitelisted by another user.").queue();
                                return;
                            }
                        }

                        // Whitelist the user
                        whitelistConfig.set(discordId, message);
                        saveWhitelist();

                        boolean useEasy = getConfig().getBoolean("use-easy-whitelist", false);
                        String cmd = useEasy ? "easywhitelist add " + message : "whitelist add " + message;
                        
                        getServer().getScheduler().runTask(WebStats.this, () -> {
                            getServer().dispatchCommand(getServer().getConsoleSender(), cmd);
                        });

                        event.getMessage().addReaction(net.dv8tion.jda.api.entities.emoji.Emoji.fromUnicode("✅")).queue();
                        
                        // Log to Dashboard
                        addEloLog(java.util.UUID.nameUUIDFromBytes(("whitelist_" + discordId).getBytes()), "WHITELISTED", message + " joined via Discord", 0);
                    }
                })
                .build();
        } catch (Exception e) {
            getLogger().severe("Failed to start Discord Bot: " + e.getMessage());
        }
    }

    private void saveWhitelist() {
        try { whitelistConfig.save(whitelistFile); } catch (Exception ignored) {}
    }

    private void startTelemetrySync() {
        if (getCommand("elo") != null) {
            getCommand("elo").setExecutor(this);
            getCommand("elo").setTabCompleter(this);
        }

        // TPS Monitor
        new BukkitRunnable() {
            @Override
            public void run() {
                long now = System.currentTimeMillis();
                long diff = now - lastTick;
                double instantTps = 1000.0 / Math.max(diff, 1);
                currentTps = (currentTps * 0.9) + (Math.min(instantTps, 20.0) * 0.1);
                lastTick = now;
            }
        }.runTaskTimer(this, 1L, 1L);

        // Sync Online Players (Every 10s)
        new BukkitRunnable() {
            @Override
            public void run() {
                syncServerStats(true);
                for (Player player : Bukkit.getOnlinePlayers()) {
                    checkPlaytimeElo(player);
                    syncPlayer(player, true);
                }
            }
        }.runTaskTimerAsynchronously(this, 100L, 200L);

        // Pulse (Every 1m)
        new BukkitRunnable() {
            @Override
            public void run() {
                recordAdvancedPulse();
            }
        }.runTaskTimerAsynchronously(this, 1200L, 1200L);
    }

    @Override
    public boolean onCommand(org.bukkit.command.CommandSender sender, org.bukkit.command.Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("elo")) return false;
        boolean isAdmin = sender.hasPermission("webstats.admin") || sender.isOp();
            
            if (args.length >= 3 && args[0].equalsIgnoreCase("set") && isAdmin) {
                Player target = Bukkit.getPlayer(args[1]);
                try {
                    int newVal = Integer.parseInt(args[2]);
                    if (target != null) {
                        setElo(target.getUniqueId(), newVal);
                        sender.sendMessage("§a[Elo] §7Set §f" + target.getName() + "§7's score to §e" + newVal);
                        syncPlayer(target, true);
                        return true;
                    }
                } catch (Exception e) { sender.sendMessage("§cInvalid number."); return true; }
            }

            if (args.length >= 1 && args[0].equalsIgnoreCase("repair")) {
                Player target = (args.length >= 2) ? Bukkit.getPlayer(args[1]) : (sender instanceof Player ? (Player)sender : null);
                
                if (target == null) {
                    sender.sendMessage("§cUsage: /elo repair [player] (Admin) or /elo repair (Self)");
                    return true;
                }

                // Permission check: Must be Admin OR repairing yourself
                boolean isSelf = (sender instanceof Player) && ((Player)sender).getUniqueId().equals(target.getUniqueId());
                if (isAdmin || isSelf) {
                    repairEloFromHistory(target);
                    sender.sendMessage("§a[Elo] §7Repaired §f" + target.getName() + "§7's score using history logs.");
                    sender.sendMessage("§7New Score: §e" + getElo(target.getUniqueId()));
                } else {
                    sender.sendMessage("§cYou can only repair your own ELO score.");
                }
                return true;
            }

            if (args.length >= 1 && args[0].equalsIgnoreCase("sync") && isAdmin) {
                sender.sendMessage("§a[Elo] §7Forcing global sync...");
                syncServerStats(true);
                for(Player p : Bukkit.getOnlinePlayers()) syncPlayer(p, true);
                sender.sendMessage("§a[Elo] §7Sync complete.");
                return true;
            }
            
            Player target = (sender instanceof Player) ? (Player) sender : null;
            if (args.length > 0) {
                target = Bukkit.getPlayer(args[0]);
                if (target == null) {
                    sender.sendMessage("§cPlayer not found.");
                    return true;
                }
            }
            if (target == null) {
                sender.sendMessage("§cUsage: /elo [player] or /elo set <player> <val>");
                return true;
            }

            int elo = getElo(target.getUniqueId());
            String rank = getRankName(elo);
            sender.sendMessage("§b§lELO STATS §8» §f" + target.getName());
            sender.sendMessage("§7Current Score: §e" + elo + " §7(" + rank + "§7)");
            if (isAdmin) sender.sendMessage("§8Build: Apr21-Revision3 (History Authoritative)");
            return true;
    }

    @Override
    public java.util.List<String> onTabComplete(org.bukkit.command.CommandSender sender, org.bukkit.command.Command command, String alias, String[] args) {
        java.util.List<String> completions = new java.util.ArrayList<>();
        if (command.getName().equalsIgnoreCase("elo")) {
            boolean isAdmin = sender.hasPermission("webstats.admin") || sender.isOp();
            if (args.length == 1) {
                completions.add("set");
                completions.add("repair");
                completions.add("sync");
                for (Player p : Bukkit.getOnlinePlayers()) completions.add(p.getName());
            } else if (args.length == 2 && args[0].equalsIgnoreCase("repair")) {
                if (isAdmin) for (Player p : Bukkit.getOnlinePlayers()) completions.add(p.getName());
            } else if (args.length == 2 && args[0].equalsIgnoreCase("set") && isAdmin) {
                for (Player p : Bukkit.getOnlinePlayers()) completions.add(p.getName());
            }
        }
        return completions;
    }

    private void checkPlaytimeElo(Player player) {
        java.util.UUID uuid = player.getUniqueId();
        int ticks = player.getStatistic(Statistic.PLAY_ONE_MINUTE);
        int totalHours = ticks / 72000;
        
        synchronized(eloLock) {
            int lastHourCount = eloConfig.getInt(uuid + ".last_hour_check", 0);
            if (totalHours > lastHourCount) {
                int hourlyGains = (totalHours - lastHourCount) * 10;
                int currentElo = getElo(uuid);
                
                setElo(uuid, currentElo + hourlyGains);
                eloConfig.set(uuid + ".last_hour_check", totalHours);
                saveEloFile();
                
                addEloLog(uuid, "Playtime", "Hourly Bonus (" + (totalHours - lastHourCount) + "h)", hourlyGains);
            }
        }
    }

    @Override
    public void onDisable() {
        if (jda != null) jda.shutdownNow();
        if (webServer != null) webServer.stop(0);
        syncServerStats(false);
        for (Player player : Bukkit.getOnlinePlayers()) {
            syncPlayer(player, false);
        }
    }

    private void loadConfig() {
        String fullUrl = getConfig().getString("firebase-url", "");
        databaseURL = fullUrl.replace("/stats.json", "").replaceAll("/$", "");
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        repairEloFromHistory(event.getPlayer()); // Automatic repair on join to ensure 100% sync
        syncPlayer(event.getPlayer(), true);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        syncPlayer(event.getPlayer(), false);
    }

    @EventHandler
    public void onPlayerDeath(org.bukkit.event.entity.PlayerDeathEvent event) {
        Player victim = event.getEntity();
        if (victim.getKiller() != null) {
            Player killer = victim.getKiller();
            java.util.UUID kId = killer.getUniqueId();
            java.util.UUID vId = victim.getUniqueId();

            // Anti-Farm Check (5 min cooldown)
            long now = System.currentTimeMillis();
            java.util.Map<java.util.UUID, Long> victims = lastKillTime.getOrDefault(kId, new java.util.HashMap<>());
            long lastKill = victims.getOrDefault(vId, 0L);
            
            if (now - lastKill < 300000) { // 5 minutes
                killer.sendMessage("§e[Elo] §7No ELO gained (Spawn-kill protection active).");
                addEloLog(kId, "Kill", victim.getName() + " (Spam Protected)", 0);
                addEloLog(vId, "Death", killer.getName() + " (Spam Protected)", 0);
                return;
            }
            victims.put(vId, now);
            lastKillTime.put(kId, victims);

            // Chess Elo Math (Standard Formula)
            int rK = getElo(kId);
            int rV = getElo(vId);
            double expectedK = 1.0 / (1.0 + Math.pow(10, (rV - rK) / 400.0));
            int gain = (int) Math.round(32.0 * (1.0 - expectedK));
            
            setElo(kId, rK + gain);
            setElo(vId, Math.max(0, rV - gain)); // Victim loses what killer gains

            killer.sendMessage("§a[Elo] §7Gained §f+" + gain + " §7from §f" + victim.getName());
            victim.sendMessage("§c[Elo] §7Lost §f-" + gain + " §7to §f" + killer.getName());

            addEloLog(kId, "Kill", victim.getName(), gain);
            addEloLog(vId, "Death", killer.getName(), -gain);

            // RankedSMP Steal Detection
            try {
                int killerRank = getRankedSMPRank(kId.toString());
                int victimRank = getRankedSMPRank(vId.toString());
                
                // A steal happens if:
                // 1. Victim has a rank (victimRank > 0)
                // 2. Killer is either unranked (killerRank == 0) OR has a worse rank (killerRank > victimRank)
                if (victimRank > 0 && (killerRank == 0 || killerRank > victimRank)) {
                    addEloLog(kId, "STEAL", victim.getName() + "'s Rank #" + victimRank, 0);
                }
            } catch (Exception ignored) {}
            
            // Force immediate sync after PvP exchange
            syncPlayer(killer, true);
            syncPlayer(victim, true);
        }
    }

    private int getElo(java.util.UUID uuid) {
        synchronized(eloLock) {
            return eloConfig.getInt(uuid.toString() + ".score", 0); // Base changed to 0
        }
    }

    private void setElo(java.util.UUID uuid, int score) {
        synchronized(eloLock) {
            eloConfig.set(uuid.toString() + ".score", score);
            saveEloFile();
        }
    }

    private void saveEloFile() {
        try { eloConfig.save(eloFile); } catch (Exception ignored) {}
    }

    private String getRankName(int elo) {
        if (elo >= 2500) return "§8[§0§lNetherite§8]";
        if (elo >= 1200) return "§b[Diamond]";
        if (elo >= 500)  return "§a[Emerald]";
        if (elo >= 150)  return "§6[Gold]";
        if (elo >= 0)    return "§f[Iron]";
        return "§6[Dirt]";
    }

    private int getGlobalRank(java.util.UUID uuid) {
        synchronized(eloLock) {
            java.util.List<Integer> scores = new java.util.ArrayList<>();
            for (String key : eloConfig.getKeys(false)) {
                scores.add(eloConfig.getInt(key + ".score", 0));
            }
            java.util.Collections.sort(scores, java.util.Collections.reverseOrder());
            int playerScore = getElo(uuid);
            return scores.indexOf(playerScore) + 1;
        }
    }

    private void repairEloFromHistory(Player player) {
        java.util.UUID uuid = player.getUniqueId();
        java.io.File logFile = new java.io.File(getDataFolder(), "elo_logs.yml");
        org.bukkit.configuration.file.YamlConfiguration logConfig = org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(logFile);
        java.util.List<String> logs = logConfig.getStringList(uuid.toString());
        
        int totalDelta = 0;
        for (String log : logs) {
            String[] split = log.split(":");
            if (split.length >= 4) {
                try { 
                    totalDelta += Integer.parseInt(split[2]); 
                } catch (Exception ignored) {}
            }
        }
        
        setElo(uuid, totalDelta); // Sum directly from 0
        syncPlayer(player, true);
    }

    private void addEloLog(java.util.UUID uuid, String type, String details, int change) {
        java.io.File file = new java.io.File(getDataFolder(), "elo_logs.yml");
        org.bukkit.configuration.file.YamlConfiguration config = org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(file);
        java.util.List<String> logs = config.getStringList(uuid.toString());
        long ts = System.currentTimeMillis() / 1000;
        int rank = getGlobalRank(uuid);
        logs.add(type + ":" + details + ":" + change + ":" + ts + ":" + rank);
        config.set(uuid.toString(), logs);
        try { config.save(file); } catch (Exception ignored) {}

        // Global Live Feed Update
        String username = org.bukkit.Bukkit.getOfflinePlayer(uuid).getName();
        if (username == null) username = "Unknown";
        String liveEntry = String.format("{\"user\":\"%s\",\"type\":\"%s\",\"details\":\"%s\",\"change\":%d,\"time\":%d}", 
            username, type, details, change, ts);
        
        synchronized(liveLogs) {
            // Check for Rank Change
            int oldRank = lastRankMap.getOrDefault(uuid, rank);
            if (oldRank != rank) {
                String rankDir = (rank < oldRank) ? "PROMOTED" : "DEMOTED";
                String rankEntry = String.format("{\"user\":\"%s\",\"type\":\"%s\",\"details\":\"Rank #%d\",\"change\":0,\"time\":%d}", 
                    username, rankDir, rank, ts);
                liveLogs.addFirst(rankEntry);
            }
            lastRankMap.put(uuid, rank);

            liveLogs.addFirst(liveEntry);
            if (liveLogs.size() > 20) liveLogs.removeLast();
            String liveJson = "[" + String.join(",", liveLogs) + "]";
            sendCloudUpdate(databaseURL + "/server/live_logs.json", liveJson, "PUT");
        }
    }

    private void syncServerStats(boolean online) {
        if (databaseURL.isEmpty() || databaseURL.contains("your-project")) return;
        updateNetworkStats();
        double mspt = calculateMSPT();
        String json = String.format("{\"tps\":%.2f, \"mspt\":%.1f, \"players_online\":%d, \"players_max\":%d, \"status\":\"%s\", \"net_in\":%.2f, \"net_out\":%.2f}", 
                currentTps, mspt, Bukkit.getOnlinePlayers().size(), Bukkit.getMaxPlayers(), online ? "online" : "offline", netInMbps, netOutMbps);
        serverHealthCache = json;
        sendCloudUpdate(databaseURL + "/server/health.json", json, "PATCH");
    }

    private double calculateMSPT() {
        try {
            return (double) Bukkit.class.getMethod("getAverageTickTime").invoke(null);
        } catch (Exception e) {
            return (5.0 * (20.0 / Math.max(0.1, currentTps))); 
        }
    }

    private void recordAdvancedPulse() {
        String dp = String.format("{\"p\":%d, \"t\":%.2f, \"m\":%.1f, \"ni\":%.2f, \"no\":%.2f, \"ts\":%d}", 
                Bukkit.getOnlinePlayers().size(), currentTps, calculateMSPT(), netInMbps, netOutMbps, System.currentTimeMillis() / 1000);
        pulseHistory.add(dp);
        if (pulseHistory.size() > 1440) pulseHistory.removeFirst();
        String json = "[" + String.join(",", pulseHistory) + "]";
        historyCache = json;
        sendCloudUpdate(databaseURL + "/server/history.json", json, "PUT");
    }

    private void syncPlayer(Player player, boolean online) {
        if (databaseURL.isEmpty() || databaseURL.contains("your-project")) return;

        String uuid = player.getUniqueId().toString();
        String skin = player.getName();
        int elo = getElo(player.getUniqueId());
        
        int mined = 0;
        int placed = 0;
        for (Material m : Material.values()) {
            if (m.isBlock()) {
                try {
                    mined += player.getStatistic(Statistic.MINE_BLOCK, m);
                    placed += player.getStatistic(Statistic.USE_ITEM, m);
                } catch (Exception ignored) {}
            }
        }

        int strength = getSkriptValue("strength::" + uuid, 0);
        String weapon = getSkriptString("weapon::" + uuid, "None");
        int rankedRank = getConfig().getBoolean("ranked-enabled", true) ? getRankedSMPRank(uuid) : 0;

        StringBuilder json = new StringBuilder("{");
        json.append("\"username\":\"").append(player.getName()).append("\",")
            .append("\"uuid\":\"").append(uuid).append("\",")
            .append("\"skin\":\"").append(skin).append("\",")
            .append("\"online\":").append(online).append(",")
            .append("\"strength\":").append(strength).append(",")
            .append("\"weapon\":\"").append(weapon).append("\",")
            .append("\"ranked\":").append(rankedRank).append(",")
            .append("\"elo\":").append(elo).append(",")
            .append("\"last_seen\":").append(System.currentTimeMillis() / 1000).append(",")
            .append("\"stats\":{")
            .append("\"total_mined\":").append(mined).append(",")
            .append("\"total_placed\":").append(placed).append(",")
            .append("\"minecraft:custom\":{");

        boolean first = true;
        for (Statistic s : Statistic.values()) {
            if (s.getType() == Statistic.Type.UNTYPED) {
                try {
                    int val = player.getStatistic(s);
                    if (val > 0) {
                        if (!first) json.append(",");
                        json.append("\"").append(s.name()).append("\":").append(val);
                        first = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("},");

        json.append("\"minecraft:mined\":{");
        first = true;
        for (Material m : Material.values()) {
            if (m.isBlock()) {
                try {
                    int val = player.getStatistic(Statistic.MINE_BLOCK, m);
                    if (val > 0) {
                        if (!first) json.append(",");
                        json.append("\"").append(m.name()).append("\":").append(val);
                        first = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("},");

        json.append("\"minecraft:killed\":{");
        first = true;
        for (EntityType type : EntityType.values()) {
            if (type.isAlive()) {
                try {
                    int val = player.getStatistic(Statistic.KILL_ENTITY, type);
                    if (val > 0) {
                        if (!first) json.append(",");
                        json.append("\"").append(type.name()).append("\":").append(val);
                        first = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("}}");

        json.append(",\"elo_logs\":[");
        try {
            java.io.File file = new java.io.File(getDataFolder(), "elo_logs.yml");
            if (file.exists()) {
                org.bukkit.configuration.file.YamlConfiguration config = org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(file);
                java.util.List<String> logs = config.getStringList(uuid);
                boolean firstLog = true;
                for (int i = logs.size() - 1; i >= 0; i--) {
                    String log = logs.get(i);
                    String[] split = log.split(":");
                    if (split.length >= 4) {
                        if (!firstLog) json.append(",");
                        json.append("{\"type\":\"").append(split[0]).append("\",\"details\":\"").append(split[1]).append("\",\"change\":").append(split[2]).append(",\"time\":").append(split[3]);
                        if (split.length >= 5) {
                            json.append(",\"rank\":").append(split[4]);
                        }
                        json.append("}");
                        firstLog = false;
                    }
                }
            }
        } catch (Exception ignored) {}
        json.append("]}");

        String result = json.toString();
        playerCache.put(uuid, result);
        sendCloudUpdate(databaseURL + "/players/" + uuid + ".json", result, "PATCH");
    }

    private void sendCloudUpdate(String url, String json, String method) {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .method(method, HttpRequest.BodyPublishers.ofString(json))
                .build();
        httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString());
    }

    private int getSkriptValue(String varName, int def) {
        try {
            // Try memory first (Live Data)
            try {
                Class<?> skriptClass = Class.forName("ch.njol.skript.variables.Variables");
                java.lang.reflect.Method getVar = skriptClass.getMethod("getVariable", String.class, org.bukkit.event.Event.class, boolean.class);
                Object val = getVar.invoke(null, varName.toLowerCase(), null, false);
                if (val instanceof Number) return ((Number) val).intValue();
            } catch (Exception ignored) {}

            // Fallback to CSV (Saved Data)
            java.io.File varFile = new java.io.File(getDataFolder().getParentFile(), "Skript/variables.csv");
            if (!varFile.exists()) return def;
            try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(varFile), java.nio.charset.StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.startsWith(varName + ",")) {
                        String[] parts = line.split(", ");
                        if (parts.length >= 3) {
                            String hex = parts[2].trim();
                            return (int) Long.parseLong(hex, 16);
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return def;
    }

    private String getSkriptString(String varName, String def) {
        try {
            // Try memory first (Live Data)
            try {
                Class<?> skriptClass = Class.forName("ch.njol.skript.variables.Variables");
                java.lang.reflect.Method getVar = skriptClass.getMethod("getVariable", String.class, org.bukkit.event.Event.class, boolean.class);
                Object val = getVar.invoke(null, varName.toLowerCase(), null, false);
                if (val != null) {
                    String result = val.toString();
                    result = result.replaceAll("(?i)\u00A7[0-9a-fk-orx]", "");
                    result = result.replace("\u00C2", "");
                    return result.trim().isEmpty() ? "None" : result.trim();
                }
            } catch (Exception ignored) {}

            // Fallback to CSV (Saved Data)
            java.io.File varFile = new java.io.File(getDataFolder().getParentFile(), "Skript/variables.csv");
            if (!varFile.exists()) return def;
            try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(varFile), java.nio.charset.StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.startsWith(varName + ",")) {
                        String[] parts = line.split(", ");
                        if (parts.length >= 3) {
                            String hex = parts[2].trim();
                            if (hex.length() > 4) {
                                try {
                                    String data = hex.substring(4); 
                                    byte[] bytes = new byte[data.length() / 2];
                                    for (int i = 0; i < bytes.length; i++) {
                                        bytes[i] = (byte) Integer.parseInt(data.substring(i * 2, i * 2 + 2), 16);
                                    }
                                    String result = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
                                    result = result.replaceAll("(?i)\u00A7[0-9a-fk-orx]", "");
                                    result = result.replace("\u00C2", "");
                                    result = toTitleCase(result.trim());
                                    return result.isEmpty() ? "None" : result;
                                } catch (Exception e) { return def; }
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return def;
    }

    private int getRankedSMPRank(String uuid) {
        java.io.File rankedFile = new java.io.File(getDataFolder().getParentFile(), "RankedSMP/config.yml");
        if (!rankedFile.exists()) return 0;
        try {
            org.bukkit.configuration.file.YamlConfiguration config = org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(rankedFile);
            if (config.contains("players." + uuid + ".rank")) {
                return config.getInt("players." + uuid + ".rank");
            }
        } catch (Exception ignored) {}
        return 0;
    }

    private String toTitleCase(String input) {
        if (input == null || input.isEmpty()) return input;
        StringBuilder titleCase = new StringBuilder(input.length());
        boolean nextTitleCase = true;
        for (char c : input.toLowerCase().toCharArray()) {
            if (!Character.isLetterOrDigit(c)) {
                nextTitleCase = true;
            } else if (nextTitleCase) {
                c = Character.toUpperCase(c);
                nextTitleCase = false;
            }
            titleCase.append(c);
        }
        return titleCase.toString();
    }
}
