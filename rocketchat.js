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

let _syncRoom_name_to_roomId
async function syncRoom_name_to_roomId() {
    if (!_syncRoom_name_to_roomId) {
        const { groups } = await get('/v1/groups.listAll', { query: { "customFields.ldapSync": true } })
        _syncRoom_name_to_roomId = _.fromPairs(groups.map(g => [ g.name, g._id ]))
    }
    return _syncRoom_name_to_roomId
}

async function create_syncRoom(name) {
    console.log("creating", name)
    try {
        const { group } = await post('/v1/groups.create', { name, customFields: { ldapSync: true } })
        _syncRoom_name_to_roomId = undefined // clear clache
        return group._id
    } catch (e) {
        if (e.errorType === 'error-duplicate-channel-name') {
            console.error(`room ${name} already exists. It must not correctly have "customFields.ldapSync"`)
            return undefined
        } else {
            throw e
        }
    }
}

async function sync_user_rooms(user, wantedRooms) {
    const name_to_id = await syncRoom_name_to_roomId()
    const userSyncRooms = user.rooms.map(r => r.name).filter(name => name_to_id[name])
    
    const userId = user._id
    for (const name of _.difference(userSyncRooms, wantedRooms)) {
        const roomId = name_to_id[name]
        console.log("removing user", user.username, "from", name)
        await post('/v1/groups.kick', { roomId, userId })
    }
    for (const name of _.difference(wantedRooms, userSyncRooms)) {
        let roomId = name_to_id[name] || await create_syncRoom(name)
        if (roomId) {
            console.log("adding user", user.username, "to", name)
            await post('/v1/groups.invite', { roomId, userId })
        }
    }
}

async function sync_user_data(user, wanted_user_data) {
    const data = _.omitBy(wanted_user_data, (val, key) => user[key] === val)
    if (!_.isEmpty(data)) {
        console.log('setting', user.username, 'data', data)
        await post('/v1/users.update', { userId: user._id, data })
    }
}

async function sync_user(username, wanted_user_data, wantedRooms) {
    //console.log(`sync_user(${username}, ${JSON.stringify(wanted_user_data)}, ${wantedRooms})`)

    const { user } = (await get("/v1/users.info", { username, fields: { userRooms: 1 } }))
    await sync_user_data(user, wanted_user_data)
    await sync_user_rooms(user, wantedRooms)
}

function listen_users_logging_in(callback) {

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
    
    ws.on('close', () => console.log('disconnected'))
    
    ws.on('message', (data) => {
        //console.log("=>", data);
        const m = JSON.parse(data)
        if (m.msg === "ping") {
            ws_send({ msg: "pong" }) // cf https://docs.rocket.chat/api/realtime-api
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
