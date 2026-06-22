export default function AgentProfileCard() {
  return (
    <div className="border rounded-lg p-4 bg-white flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">R</div>
      <div className="flex-1">
        <div className="font-semibold">ResearchBot</div>
        <div className="text-xs text-gray-500">Autonomous research agent</div>
      </div>
      <div className="text-right text-xs">
        <div className="text-gray-500">Wallet: 0xABC...7F2</div>
        <div className="text-gray-500">Balance: 0.5 ETH</div>
        <div className="text-gray-500">Reputation: 85/100</div>
      </div>
    </div>
  )
}
