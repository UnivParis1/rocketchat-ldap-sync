const _ = require('lodash')
const fetch = require('node-fetch')
const WebSocket = require('ws');

const config = require('./config').rocketchat

const to_json_string = (s) => _.isObject(s) ? JSON.stringify(s) : s

// Rocket.Chat API query params can be json
const qs_to_string = (qs) => {
    const params = "" + new URLSearchParams(_.mapValues(qs, to_json_string))
    return params ? "?" + params : ""
}

const request = async (api_method, qs, body) => {
    const url = config.api_url + api_method + qs_to_string(qs)
    let params = { headers: { 'X-Auth-Token': config.authToken, 'X-User-Id': config.authUserId, 'Content-type': 'application/json' } }
    if (body) {
        params.method = 'POST'
        params.body = to_json_string(body)
    }
    const response = await fetch(url, params)
    const contentType = response.headers.get('content-type')
    if (contentType !== 'application/json') {
        const err = "expected json, got " + contentType
        console.error(url, err)
        throw err
    }
    const json = await response.json()
    if (json && json.success) {
        return json
    } else if (json) {
        console.error(url, json)
        throw json
    } else {
        console.error(response)
        throw response
    }
}

const get = async (api_method, qs) => request(api_method, qs, undefined)
const post = async (api_method, body) => request(api_method, {}, body)

let _syncRooms
async function syncRooms() {
    if (!_syncRooms) {
        const { groups } = await get('/v1/groups.listAll', { query: { "customFields.ldapSync": true }, count: 0 })
        _syncRooms = {
            to_fname: _.fromPairs(groups.map(g => [ g._id, g.fname ])),
            from_fname: _.fromPairs(groups.map(g => [ g.fname, g._id ])),
        }
    }
    return _syncRooms
}

async function create_syncRoom({ fname, description }) {
    const topic = `Salon privé d'échange pour les membres ${fname}`
    console.log("creating", fname, description)
    try {
        const { group } = await post('/v1/groups.create', { name: fname, customFields: { ldapSync: true } })
        _syncRooms = undefined // clear clache
        const roomId = group._id
        await post('/v1/groups.setDescription', { roomId, description })
        await post('/v1/groups.setTopic', { roomId, topic })
        return roomId
    } catch (e) {
        if (e.errorType === 'error-duplicate-channel-name') {
            console.error(`room ${fname} already exists. It must not correctly have "customFields.ldapSync"`)
            return undefined
        } else {
            throw e
        }
    }
}

async function sync_user_rooms(user, wantedRooms) {
    const rooms = await syncRooms()
    const userSyncRooms = user.rooms.map(room => ({ fname: rooms.to_fname[room.rid], ...room })).filter(room => room.fname)
    
    const userId = user._id
    for (const room of _.differenceBy(userSyncRooms, wantedRooms, 'fname')) {
        const roomId = room.rid
        console.log("removing user", user.username, "from", room.name)
        await post('/v1/groups.kick', { roomId, userId })
    }
    for (const room of _.differenceBy(wantedRooms, userSyncRooms, 'fname')) {
        let roomId = rooms.from_fname[room.fname] || await create_syncRoom(room)
        if (roomId) {
            console.log("adding user", user.username, "to", room.fname)
            await post('/v1/groups.invite', { roomId, userId })
        }
    }
}

async function sync_user_data(user, wanted_user_data) {
    const data = _.omitBy(wanted_user_data, (val, key) => (user[key] || '') === val) // NB: '' means remove value in API, so Rocket.Chat will not store empty values
    if (!_.isEmpty(data)) {
        console.log('setting', user.username, 'data', data)
        await post('/v1/users.update', { userId: user._id, data })
    }
}

async function sync_user(username, wanted_user_data, wantedRooms) {
    //console.log(`sync_user(${username}, ${JSON.stringify(wanted_user_data)}, ${JSON.stringify(wantedRooms)})`)

    let user
    try {
        user = (await get("/v1/users.info", { username, fields: { userRooms: 1 } })).user
    } catch {
        console.log("creating", username)
        user = (await post("/v1/users.create", { username, password: Math.random().toString(36), ..._.pick(wanted_user_data, 'email', 'name') })).user
        user.rooms = []

    }
    if (user) {
        user.email = user.emails[0].address // for comparison
        await sync_user_data(user, wanted_user_data)
    } else {
        users.rooms = []
    }
    await sync_user_rooms(user, wantedRooms)
}

function listen_users_logging_in(callback, onerror) {

    const ws = new WebSocket('ws://localhost:3000/websocket');
    const ws_send = (param) => ws.send(JSON.stringify(param))
    
    ws.on('open', () => {
        ws_send({ msg: "connect", version: "1", support: ["1"] })
        ws_send({
            msg: "method", method: "login", id: "42",
            params: [ { resume: config.authToken } ]
        })
        ws_send({
            msg: "sub", name: "stream-notify-logged", id: "44",
            params: [ "user-status", false ]
        })
    });
    
    ws.on('close', () => {
        console.log('disconnected from Rocket.Chat WebSocket. Exiting...')
        process.exit(1) // will rely on systemd to restart
    })
    
    ws.on('message', (data) => {
        //console.log("=>", data);
        const m = JSON.parse(data)
        if (m.msg === "ping") {
            ws_send({ msg: "pong" }) // cf https://docs.rocket.chat/api/realtime-api
        } else if (m.msg === "result" && m.error) {
            onerror(m.error);
        } else if (m.msg === "changed" && m.collection === "stream-notify-logged" && m.fields.eventName === "user-status") {
            for (const [userId, username, status, _] of m.fields.args) {
                if (status === 1 && userId !== config.authUserId) {
                    callback(username)
                }
            }
        }
    });
}

module.exports = { sync_user, listen_users_logging_in }
