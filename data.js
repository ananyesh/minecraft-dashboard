const MOCK_PLAYERS = [
    {
        username: "Admin",
        uuid: "7ce279b9-d830-4e35-ae63-2283e7428f52",
        online: true,
        stats: {
            "minecraft:custom": {
                "minecraft:play_one_minute": 864000, // 240 hours
                "minecraft:deaths": 12,
                "minecraft:player_kills": 45,
                "minecraft:mob_kills": 1250,
                "minecraft:jump": 5420,
                "minecraft:walk_one_cm": 15000000
            },
            "minecraft:mined": {
                "minecraft:diamond_ore": 84,
                "minecraft:stone": 45000,
                "minecraft:iron_ore": 1200,
                "minecraft:deepslate_diamond_ore": 22
            },
            "minecraft:killed": {
                "minecraft:zombie": 450,
                "minecraft:skeleton": 210,
                "minecraft:creeper": 85
            }
        }
    },
    {
        username: "Kutto",
        uuid: "06973021-36a4-4762-a305-4485c40d2d31",
        online: true,
        stats: {
            "minecraft:custom": {
                "minecraft:play_one_minute": 432000, // 120 hours
                "minecraft:deaths": 25,
                "minecraft:player_kills": 12,
                "minecraft:mob_kills": 850
            },
            "minecraft:mined": {
                "minecraft:diamond_ore": 12,
                "minecraft:stone": 15000,
                "minecraft:iron_ore": 600
            }
        }
    },
    {
        username: "Dream",
        uuid: "ec70bcaf-702f-4bb2-848d-27663cba50b0",
        online: false,
        stats: {
            "minecraft:custom": {
                "minecraft:play_one_minute": 2592000, // 720 hours
                "minecraft:deaths": 0,
                "minecraft:player_kills": 500,
                "minecraft:mob_kills": 10000
            },
            "minecraft:mined": {
                "minecraft:diamond_ore": 500,
                "minecraft:stone": 100000
            }
        }
    },
    {
        username: "Technoblade",
        uuid: "ad8b1228-78ab-4171-985f-8d94071ec6d9",
        online: false,
        stats: {
            "minecraft:custom": {
                "minecraft:play_one_minute": 5000000,
                "minecraft:deaths": 1,
                "minecraft:player_kills": 9999,
                "minecraft:mob_kills": 50000
            },
            "minecraft:mined": {
                "minecraft:diamond_ore": 1000,
                "minecraft:stone": 500000
            }
        }
    },
    {
        username: "Grian",
        uuid: "f076b9df-df4b-4024-8176-522100806950",
        online: true,
        stats: {
            "minecraft:custom": {
                "minecraft:play_one_minute": 1296000,
                "minecraft:deaths": 42,
                "minecraft:player_kills": 5,
                "minecraft:mob_kills": 300
            },
            "minecraft:mined": {
                "minecraft:diamond_ore": 5,
                "minecraft:stone": 200000 // A lot of building
            }
        }
    }
];

// Globally accessible for app.js
window.minecraftData = MOCK_PLAYERS;
